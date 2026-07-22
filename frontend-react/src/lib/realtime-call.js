const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const INPUT_CHUNK_SAMPLES = 320; // 20ms @ 16kHz

function websocketUrl(roleId) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  return `${protocol}//${host}/api/realtime-call?character_id=${encodeURIComponent(roleId)}`;
}

export function createRealtimeCallSocket(roleId, handlers = {}) {
  const socket = new WebSocket(websocketUrl(roleId));
  socket.binaryType = "arraybuffer";

  socket.addEventListener("open", () => handlers.onOpen?.());
  socket.addEventListener("close", (event) => handlers.onClose?.(event));
  socket.addEventListener("error", () => handlers.onError?.(new Error("实时通话连接失败")));
  socket.addEventListener("message", async (event) => {
    if (event.data instanceof ArrayBuffer) {
      handlers.onAudio?.(event.data);
      return;
    }
    if (event.data instanceof Blob) {
      handlers.onAudio?.(await event.data.arrayBuffer());
      return;
    }

    try {
      handlers.onEvent?.(JSON.parse(String(event.data || "{}")));
    } catch {
      // 忽略非 JSON 控制消息。
    }
  });

  return {
    get readyState() { return socket.readyState; },
    sendAudio(arrayBuffer) {
      if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 2 * 1024 * 1024) {
        socket.send(arrayBuffer);
      }
    },
    send(message) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
    interrupt() {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "interrupt" }));
    },
    close() {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "finish" }));
      }
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
        socket.close(1000, "hangup");
      }
    },
  };
}

class PcmChunker {
  constructor(inputSampleRate, onChunk) {
    this.inputSampleRate = inputSampleRate;
    this.onChunk = onChunk;
    this.pending = [];
  }

  push(floatSamples) {
    for (let index = 0; index < floatSamples.length; index += 1) {
      this.pending.push(floatSamples[index]);
    }

    const inputSamplesPerChunk = Math.round(
      INPUT_CHUNK_SAMPLES * this.inputSampleRate / INPUT_SAMPLE_RATE,
    );

    while (this.pending.length >= inputSamplesPerChunk) {
      const source = this.pending.splice(0, inputSamplesPerChunk);
      const output = new Int16Array(INPUT_CHUNK_SAMPLES);
      const ratio = source.length / INPUT_CHUNK_SAMPLES;

      for (let outIndex = 0; outIndex < INPUT_CHUNK_SAMPLES; outIndex += 1) {
        const start = Math.floor(outIndex * ratio);
        const end = Math.max(start + 1, Math.floor((outIndex + 1) * ratio));
        let total = 0;
        let count = 0;
        for (let sourceIndex = start; sourceIndex < end && sourceIndex < source.length; sourceIndex += 1) {
          total += source[sourceIndex];
          count += 1;
        }
        const sample = Math.max(-1, Math.min(1, count ? total / count : 0));
        output[outIndex] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }

      this.onChunk(output.buffer);
    }
  }
}

async function createWorkletCapture(context, source, chunker) {
  const sourceCode = `
    class RuoBaiRealtimeMic extends AudioWorkletProcessor {
      process(inputs) {
        const input = inputs[0] && inputs[0][0];
        if (input && input.length) this.port.postMessage(input.slice());
        return true;
      }
    }
    registerProcessor("ruobai-realtime-mic", RuoBaiRealtimeMic);
  `;
  const blobUrl = URL.createObjectURL(new Blob([sourceCode], { type: "text/javascript" }));
  try {
    await context.audioWorklet.addModule(blobUrl);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }

  const worklet = new AudioWorkletNode(context, "ruobai-realtime-mic", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  const silentGain = context.createGain();
  silentGain.gain.value = 0;
  worklet.port.onmessage = (event) => chunker.push(new Float32Array(event.data));
  source.connect(worklet);
  worklet.connect(silentGain);
  silentGain.connect(context.destination);
  return { node: worklet, silentGain };
}

function createScriptProcessorCapture(context, source, chunker) {
  const processor = context.createScriptProcessor(2048, 1, 1);
  const silentGain = context.createGain();
  silentGain.gain.value = 0;
  processor.onaudioprocess = (event) => {
    chunker.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  processor.connect(silentGain);
  silentGain.connect(context.destination);
  return { node: processor, silentGain };
}

export async function startRealtimeMicrophone(onChunk) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: INPUT_SAMPLE_RATE,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContextClass({ sampleRate: INPUT_SAMPLE_RATE, latencyHint: "interactive" });
  await context.resume();
  const source = context.createMediaStreamSource(stream);
  const chunker = new PcmChunker(context.sampleRate, onChunk);
  const capture = context.audioWorklet
    ? await createWorkletCapture(context, source, chunker)
    : createScriptProcessorCapture(context, source, chunker);

  let muted = false;
  return {
    context,
    get muted() { return muted; },
    setMuted(value) {
      muted = Boolean(value);
      stream.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    },
    async stop() {
      try { capture.node.disconnect(); } catch {}
      try { capture.silentGain.disconnect(); } catch {}
      try { source.disconnect(); } catch {}
      stream.getTracks().forEach((track) => track.stop());
      await context.close().catch(() => {});
    },
  };
}

export class RealtimePcmPlayer {
  constructor() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.context = new AudioContextClass({ latencyHint: "interactive" });
    this.nextStartAt = 0;
    this.sources = new Set();
    this.muted = false;
  }

  async resume() {
    if (this.context.state === "suspended") await this.context.resume();
  }

  setMuted(value) {
    this.muted = Boolean(value);
    if (this.muted) this.interrupt();
  }

  enqueue(arrayBuffer) {
    if (this.muted || !arrayBuffer?.byteLength) return;
    const int16 = new Int16Array(arrayBuffer);
    const audioBuffer = this.context.createBuffer(1, int16.length, OUTPUT_SAMPLE_RATE);
    const channel = audioBuffer.getChannelData(0);
    for (let index = 0; index < int16.length; index += 1) {
      channel[index] = int16[index] / 0x8000;
    }

    const source = this.context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.context.destination);
    const now = this.context.currentTime;
    const startAt = Math.max(now + 0.035, this.nextStartAt);
    source.start(startAt);
    this.nextStartAt = startAt + audioBuffer.duration;
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
  }

  interrupt() {
    for (const source of this.sources) {
      try { source.stop(); } catch {}
    }
    this.sources.clear();
    this.nextStartAt = this.context.currentTime;
  }

  async close() {
    this.interrupt();
    await this.context.close().catch(() => {});
  }
}
