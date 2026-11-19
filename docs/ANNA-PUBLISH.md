# BriefDeck 的 Anna staging 上传流程

BriefDeck 使用静态 UI 包。根目录的 `app.json` 提供展示信息，`manifest.json` 声明 UI 入口和窗口。浏览器通过 Anna Runtime 调用宿主的 `llm.complete`。模型由平台提供，项目无需部署独立模型服务。构建将页面、脚本和浏览器端依赖整理到 `release/bundle/`。

## 已执行步骤

1. **激活开发者并授权 CLI。** 在 staging 注册和验证邮箱，进入开发者控制台。运行 `anna-app login --host https://staging.anna.partners` 并在浏览器批准授权。使用 staging 账号完成后续命令。 [Anna 官方开发教程](https://forum.anna.partners/t/build-on-anna-101/228)
2. **构建和校验。** 运行 `npm run build`，再用 `anna-app validate --bundle release/bundle --strict` 检查 manifest 与 UI 文件。
3. **上传工作草稿。** 运行 `anna-app apps push --bundle-dir release/bundle --account https://staging.anna.partners`。CLI 读取项目配置并上传静态资源。日志显示 `working bundle staged` 和 `ready` 后，平台已收到开发草稿。该状态可以继续修改。 [UI 包流程](https://staging.anna.partners/developers/apps/app-ui-bundle.md)
4. **创建测试版本并安装。** 运行 `anna-app apps cut 0.1.7 --account https://staging.anna.partners` 把工作草稿固定成版本，用 `anna-app apps versions briefdeck --account https://staging.anna.partners` 核对。在开发者页安装测试版本，到「已安装应用」打开。普通商店下载优先查找公开版本，草稿阶段使用开发者入口。 [Anna 官方安装教程](https://forum.anna.partners/t/build-on-anna-101/228)

已确认的 staging App 名称为 **汇报成稿 BriefDeck**，完整 slug 为 **`@keyzhang/briefdeck`**。最新开发者测试版为 `0.1.7`，由草稿 rev 9 建立，版本 ID 为 688。`0.1.6` 的两次真实调用已记录，`0.1.7` 修复其视觉和诊断问题。2026-11-20 最后一次 CLI 核对的审核绑定版本为 `0.1.6`，状态为 `pending_review`。

## 真实验证与公开发布

在 staging 用测试版本确认真实生成、编辑和导出。通过后，开发者可以从「版本」页提交审核，也可以用 `anna-app apps submit-review`。审核绑定一个具体版本。平台批准后，从控制台发布该版本或用 `anna-app apps release <版本号>`，再用其他账号验证实际访问。 [Anna 官方发布文档](https://github.com/Anna-Partners/anna-developer-docs/blob/main/docs/apps/app-publish.md)

GitHub 用于交付源码、测试与验收记录。Anna staging 的应用版本由 CLI 或开发者控制台管理。2026-11-19 已提交 `0.1.5`，平台确认状态为 `pending_review`。后续切版不会自动加入本轮审核。 [交付进度](DELIVERY.md)
