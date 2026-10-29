package fun.lshl.ruobai;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeTextToSpeechPlugin.class);
        registerPlugin(NativeSpeechRecognitionPlugin.class);
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(LiveUpdatePlugin.class);
        registerPlugin(PushPollPlugin.class);
        super.onCreate(savedInstanceState);

        // 从「她的消息」通知点进来时，记下该跳哪个角色，前端启动后会取一次。
        captureOpenTarget(getIntent());

        // Let the web app consume Android Back before closing the native shell.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() == null ? null : getBridge().getWebView();
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                    return;
                }

                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureOpenTarget(intent);
    }

    private void captureOpenTarget(Intent intent) {
        if (intent == null) return;
        int characterId = intent.getIntExtra("ruobai_character_id", 0);
        if (characterId <= 0) return;
        long messageId = intent.getLongExtra("ruobai_message_id", 0L);
        PushPollPlugin.setPendingOpen(characterId, messageId);
        notifyWebOfPendingOpen();
    }

    /**
     * App 已经在后台时点通知，走 onNewIntent —— 这时 React 早就挂载好了、
     * 单纯存一个 pending 它不会自己发现，所以要主动敲一下网页。
     *
     * 冷启动时 WebView 还没建好，这里会直接跳过；那种情况由前端在角色列表
     * 加载完之后自己 consumePendingOpen() 取走（见 App.jsx）。
     */
    private void notifyWebOfPendingOpen() {
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView == null) return;
        webView.post(() -> {
            try {
                webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('ruobai:open-target'));", null);
            } catch (Throwable ignored) {
                // 敲不动也不影响：用户还能自己在列表里点进聊天
            }
        });
    }
}
