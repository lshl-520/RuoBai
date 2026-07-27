package fun.lshl.ruobai;

import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@CapacitorPlugin(name = "NativeTextToSpeech")
public class NativeTextToSpeechPlugin extends Plugin {

    private TextToSpeech textToSpeech;
    private volatile boolean ready = false;
    private volatile boolean initializing = true;
    private volatile String initError = "APP 原生朗读正在准备，请稍后再试";
    private final Map<String, PluginCall> pendingCalls = new ConcurrentHashMap<>();
    private final List<PendingSpeakRequest> waitingForInitialization = new ArrayList<>();

    private static final class PendingSpeakRequest {
        final PluginCall call;
        final String text;
        final String language;
        final float rate;
        final float pitch;

        PendingSpeakRequest(PluginCall call, String text, String language, float rate, float pitch) {
            this.call = call;
            this.text = text;
            this.language = language;
            this.rate = rate;
            this.pitch = pitch;
        }
    }

    @Override
    public void load() {
        initializing = true;
        getActivity().runOnUiThread(() -> {
            textToSpeech = new TextToSpeech(getContext(), status -> {
                if (status == TextToSpeech.SUCCESS) {
                    ready = true;
                    initializing = false;
                    initError = "";
                    textToSpeech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override
                        public void onStart(String utteranceId) {}

                        @Override
                        public void onDone(String utteranceId) {
                            finishCall(utteranceId, "done", null);
                        }

                        @Override
                        public void onError(String utteranceId) {
                            finishCall(utteranceId, "error", "Android 朗读失败");
                        }

                        @Override
                        public void onError(String utteranceId, int errorCode) {
                            finishCall(utteranceId, "error", "Android 朗读失败（" + errorCode + "）");
                        }

                        @Override
                        public void onStop(String utteranceId, boolean interrupted) {
                            finishCall(utteranceId, "stopped", null);
                        }
                    });
                    drainInitializationQueue();
                } else {
                    ready = false;
                    initializing = false;
                    initError = "手机的文字朗读服务没有准备好";
                    rejectInitializationQueue(initError);
                }
            });
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "").trim();
        if (text.isEmpty()) {
            call.reject("没有可以朗读的文字");
            return;
        }
        String language = call.getString("language", "zh-CN");
        float rate = clamp(call.getFloat("rate", 0.95f), 0.5f, 2.0f);
        float pitch = clamp(call.getFloat("pitch", 1.05f), 0.5f, 2.0f);
        PendingSpeakRequest request = new PendingSpeakRequest(call, text, language, rate, pitch);

        if (!ready && initializing) {
            synchronized (waitingForInitialization) {
                if (!ready && initializing) {
                    waitingForInitialization.add(request);
                    return;
                }
            }
        }
        if (!ready || textToSpeech == null) {
            call.reject(initError);
            return;
        }
        speakWhenReady(request);
    }

    private void speakWhenReady(PendingSpeakRequest request) {
        if (!ready || textToSpeech == null) {
            request.call.reject(initError);
            return;
        }
        String utteranceId = UUID.randomUUID().toString();
        pendingCalls.put(utteranceId, request.call);

        getActivity().runOnUiThread(() -> {
            Locale locale = Locale.forLanguageTag(request.language);
            int languageResult = textToSpeech.setLanguage(locale);
            if (languageResult == TextToSpeech.LANG_MISSING_DATA || languageResult == TextToSpeech.LANG_NOT_SUPPORTED) {
                languageResult = textToSpeech.setLanguage(Locale.SIMPLIFIED_CHINESE);
            }
            if (languageResult == TextToSpeech.LANG_MISSING_DATA || languageResult == TextToSpeech.LANG_NOT_SUPPORTED) {
                pendingCalls.remove(utteranceId);
                request.call.reject("手机没有可用的中文朗读音色");
                return;
            }

            textToSpeech.setSpeechRate(request.rate);
            textToSpeech.setPitch(request.pitch);
            Bundle params = new Bundle();
            int result = textToSpeech.speak(request.text, TextToSpeech.QUEUE_FLUSH, params, utteranceId);
            if (result == TextToSpeech.ERROR) {
                pendingCalls.remove(utteranceId);
                request.call.reject("手机没有成功开始朗读");
            }
        });
    }

    private void drainInitializationQueue() {
        List<PendingSpeakRequest> queued;
        synchronized (waitingForInitialization) {
            queued = new ArrayList<>(waitingForInitialization);
            waitingForInitialization.clear();
        }
        for (PendingSpeakRequest request : queued) {
            speakWhenReady(request);
        }
    }

    private void rejectInitializationQueue(String error) {
        List<PendingSpeakRequest> queued;
        synchronized (waitingForInitialization) {
            queued = new ArrayList<>(waitingForInitialization);
            waitingForInitialization.clear();
        }
        for (PendingSpeakRequest request : queued) {
            request.call.reject(error);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        rejectInitializationQueue("朗读已停止");
        if (textToSpeech == null) {
            call.resolve();
            return;
        }
        getActivity().runOnUiThread(() -> {
            textToSpeech.stop();
            for (Map.Entry<String, PluginCall> entry : pendingCalls.entrySet()) {
                finishCall(entry.getKey(), "stopped", null);
            }
            call.resolve();
        });
    }

    private void finishCall(String utteranceId, String state, String error) {
        PluginCall call = pendingCalls.remove(utteranceId);
        if (call == null) return;
        if (error != null) {
            call.reject(error);
            return;
        }
        JSObject result = new JSObject();
        result.put("state", state);
        call.resolve(result);
    }

    private float clamp(float value, float min, float max) {
        return Math.max(min, Math.min(max, value));
    }

    @Override
    protected void handleOnDestroy() {
        initializing = false;
        rejectInitializationQueue("朗读已停止");
        for (Map.Entry<String, PluginCall> entry : pendingCalls.entrySet()) {
            finishCall(entry.getKey(), "stopped", null);
        }
        if (textToSpeech != null) {
            textToSpeech.stop();
            textToSpeech.shutdown();
            textToSpeech = null;
        }
        ready = false;
        super.handleOnDestroy();
    }
}
