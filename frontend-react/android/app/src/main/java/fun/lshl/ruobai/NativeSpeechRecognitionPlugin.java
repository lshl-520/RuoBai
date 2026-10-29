package fun.lshl.ruobai;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;

/**
 * 语音识别（把用户说的话变成文字）—— 2026/9/19
 *
 * 为什么要有这个原生插件：
 *   以前语音转文字用的是浏览器自带的识别（window.SpeechRecognition），
 *   它在 App 的 WebView 里不可靠，识别结果经常是空的 —— 用户实测发语音，
 *   小白只能回"我听不到，你打字吧"。
 *
 *   用户的路线是"脱离服务器也要能用"，所以识别必须走**设备自己**：
 *   这里用 Android 系统的 SpeechRecognizer，Android 13+ 支持完全离线识别，
 *   不经过若白服务器、不产生额外费用、录音不离开手机。
 *
 * 对外事件（JS 侧监听）：
 *   partial { text }  —— 边说边出的临时结果
 *   final   { text }  —— 最终结果
 *   error   { code, message } —— 失败，code 沿用浏览器那套命名
 *   end     {}        —— 本次识别结束
 */
@CapacitorPlugin(
    name = "NativeSpeechRecognition",
    permissions = {
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone")
    }
)
public class NativeSpeechRecognitionPlugin extends Plugin {

    private SpeechRecognizer recognizer;
    private boolean listening = false;
    private String lastPartial = "";

    @PluginMethod
    public void isAvailable(PluginCall call) {
        Context context = getContext();
        JSObject result = new JSObject();
        result.put("available", SpeechRecognizer.isRecognitionAvailable(context));
        result.put("onDevice", isOnDeviceAvailable(context));
        call.resolve(result);
    }

    /** Android 12+ 才有"设备端离线识别"这个概念。 */
    private boolean isOnDeviceAvailable(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false;
        try {
            return SpeechRecognizer.isOnDeviceRecognitionAvailable(context);
        } catch (Throwable error) {
            return false;
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
            return;
        }
        beginListening(call);
    }

    @PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED) {
            beginListening(call);
        } else {
            JSObject data = new JSObject();
            data.put("code", "not-allowed");
            data.put("message", "没有麦克风权限，请在系统设置里允许若白使用麦克风");
            notifyListeners("error", data);
            notifyListeners("end", new JSObject());
            call.reject("没有麦克风权限");
        }
    }

    private void beginListening(PluginCall call) {
        final String language = call.getString("language", "zh-CN");
        final boolean preferOnDevice = !Boolean.FALSE.equals(call.getBoolean("preferOnDevice", true));

        getActivity().runOnUiThread(() -> {
            try {
                destroyRecognizer();
                lastPartial = "";

                Context context = getContext();
                boolean usingOnDevice = false;
                if (preferOnDevice && isOnDeviceAvailable(context)) {
                    try {
                        recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(context);
                        usingOnDevice = true;
                    } catch (Throwable ignored) {
                        recognizer = null;
                    }
                }
                if (recognizer == null) {
                    recognizer = SpeechRecognizer.createSpeechRecognizer(context);
                }
                recognizer.setRecognitionListener(listener);

                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                if (usingOnDevice) {
                    intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
                }

                listening = true;
                recognizer.startListening(intent);
                call.resolve();
            } catch (Throwable error) {
                listening = false;
                destroyRecognizer();
                JSObject data = new JSObject();
                data.put("code", "not-supported");
                data.put("message", String.valueOf(error.getMessage()));
                notifyListeners("error", data);
                notifyListeners("end", new JSObject());
                call.reject("语音识别启动失败");
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                if (recognizer != null && listening) recognizer.stopListening();
            } catch (Throwable ignored) { }
            call.resolve();
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            listening = false;
            destroyRecognizer();
            call.resolve();
        });
    }

    private void destroyRecognizer() {
        if (recognizer == null) return;
        try {
            recognizer.cancel();
            recognizer.destroy();
        } catch (Throwable ignored) { }
        recognizer = null;
    }

    private void emit(String event, String text) {
        JSObject data = new JSObject();
        data.put("text", text == null ? "" : text);
        notifyListeners(event, data);
    }

    private void emitError(int errorCode) {
        JSObject data = new JSObject();
        data.put("code", mapError(errorCode));
        data.put("message", describeError(errorCode));
        notifyListeners("error", data);
    }

    /** 把 Android 的错误码翻译成和浏览器一致的命名，JS 侧一套文案就够用。 */
    private String mapError(int errorCode) {
        switch (errorCode) {
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "no-speech";
            case SpeechRecognizer.ERROR_AUDIO:
                return "audio-capture";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "not-allowed";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
            case SpeechRecognizer.ERROR_SERVER:
                return "network";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "busy";
            case SpeechRecognizer.ERROR_CLIENT:
                return "aborted";
            default:
                return "error";
        }
    }

    private String describeError(int errorCode) {
        switch (errorCode) {
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "没有听清，再说一次试试";
            case SpeechRecognizer.ERROR_AUDIO:
                return "麦克风被占用了，关掉别的录音再试";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "没有麦克风权限";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "手机的语音识别服务连不上，稍后再试";
            case SpeechRecognizer.ERROR_SERVER:
                return "手机识别服务返回了错误，稍后再试";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "识别还在忙，等一下再试";
            default:
                return "识别失败，再试一次";
        }
    }

    private final RecognitionListener listener = new RecognitionListener() {
        @Override public void onReadyForSpeech(Bundle params) { }

        @Override public void onBeginningOfSpeech() { }

        @Override public void onRmsChanged(float rmsdB) { }

        @Override public void onBufferReceived(byte[] buffer) { }

        @Override public void onEndOfSpeech() { }

        @Override
        public void onError(int error) {
            listening = false;
            emitError(error);
            notifyListeners("end", new JSObject());
            destroyRecognizer();
        }

        @Override
        public void onResults(Bundle results) {
            listening = false;
            String text = firstResult(results);
            if (text.isEmpty()) text = lastPartial;
            emit("final", text);
            notifyListeners("end", new JSObject());
            destroyRecognizer();
        }

        @Override
        public void onPartialResults(Bundle partialResults) {
            String text = firstResult(partialResults);
            if (text.isEmpty()) return;
            lastPartial = text;
            emit("partial", text);
        }

        @Override public void onEvent(int eventType, Bundle params) { }
    };

    private String firstResult(Bundle bundle) {
        if (bundle == null) return "";
        ArrayList<String> matches = bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (matches == null || matches.isEmpty()) return "";
        String first = matches.get(0);
        return first == null ? "" : first.trim();
    }

    @Override
    protected void handleOnDestroy() {
        listening = false;
        destroyRecognizer();
        super.handleOnDestroy();
    }
}