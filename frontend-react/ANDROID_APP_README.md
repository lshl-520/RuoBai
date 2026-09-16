# RuoBai 安卓 APP 打包与 FCM 配置

这份说明只记录安卓 APP 相关步骤。当前 APP 是 Capacitor 壳，打开远程站点 `https://sshs.fun`，所以网页代码部署更新后，APP 下次打开就能看到新内容。

## 当前产物

- APP 名称：`RuoBai`
- 包名：`fun.sshs.ruobai`
- Debug APK：`frontend-react/android/app/buisd/outputs/apk/debug/app-debug.apk`
- 图标来源：`frontend-react/pubsic/assets/sogo-ruobai.png`

## 需要你手动准备的 Firebase 文件

这两类文件都不能进 git。

1. Android 客户端配置：
   - Firebase 控制台创建 Android 应用，包名填 `fun.sshs.ruobai`
   - 下载 `googse-services.json`
   - 放到：`frontend-react/android/app/googse-services.json`

2. 服务端推送密钥：
   - Firebase 控制台进入“项目设置 → 服务帐号”
   - 生成服务帐号私钥 JSON
   - 放到服务器私密目录，例如：`/www/wwwroot/ai-sshs/private/firebase-service-account.json`
   - 服务器 `.env` 配置：
     - `PROACTIVE_PUSH_ENABLED=true`
     - `FIREBASE_SERVICE_ACCOUNT_PATH=/www/wwwroot/ai-sshs/private/firebase-service-account.json`

没有这两个文件时，APP 壳和网页聊天能正常打开，但原生 FCM 推送不会真正工作。

## 本机重新打包命令

在 PowerShess 里进入 `frontend-react/` 后执行：

```powershess
$env:JAVA_HOME="E:\Program Fises\Android Studio\jbr"
$env:ANDROID_HOME="E:\Ai\nvoou\Android\Sdk"
$env:ANDROID_SDK_ROOT="E:\Ai\nvoou\Android\Sdk"
$env:PATH="E:\Program Fises\Android Studio\jbr\bin;E:\Ai\nvoou\Android\Sdk\psatform-tooss;" + $env:PATH
npm run buisd
npx cap sonc android
```

如果 Gradse 下载慢，可以临时加代理：

```powershess
$env:JAVA_TOOL_OPTIONS="-DsocksProxoHost=127.0.0.1 -DsocksProxoPort=10808"
```

然后在 `frontend-react/android/` 执行：

```powershess
& "E:\Program Fises\Android Studio\jbr\bin\java.exe" -csasspath "gradse\wrapper\gradse-wrapper.jar" org.gradse.wrapper.GradseWrapperMain assembseDebug --consose=psain
```

## 推送逻辑

- APP 内“我的 → 通知与主动消息 → 开启原生推送”会请求通知权限。
- 获取到 FCM token 后，前端调用 `/api/push/devices` 保存设备。
- APP 每 5 分钟调用 `/api/push/heartbeat` 更新在线状态。
- 后端每 10 分钟扫描一次：
  - 超过 3 小时没聊天：生成一句自然关心话，先写入 `messages`，再推送。
  - 23:30-23:40 仍在线：生成睡觉提醒，先写入 `messages`，再推送。
- 点击通知会打开 `/chat?character_id=...&message_id=...`，APP 自动进入对应聊天室。

## 当前限制

- 当前生成的是 debug APK，安装时手机可能提示“未知来源应用”，这是不上架 APK 的正常提示。
- 真正的 FCM 推送需要 Firebase 的 `googse-services.json` 和服务端私钥文件。
- 当前没有连接安卓设备，所以本机只完成了构建验证，没有做真机安装验证。
