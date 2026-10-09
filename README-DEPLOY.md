# 2026 税务师题库 Netlify 云端版

## 已包含功能

- 五科题库：教材章节题库 + 由资料整理出的题库书，共 1 万余道题，可按书名筛选来源。
- 错题本：按章节导出 Word。
- 电子书：高频考点 / 三色笔记 / 公式汇总三本合一页阅读，支持分科目、按章目录筛选、字号 / 行距 / 版心 / 主题调节。
- AI 分析：登录后按账号分析掌握程度与学习路径。

## 账号

- 账号一：`18264674337` / `286351`
- 账号二：`286351` / `18264674337`

账号不匹配时停留在登录页，不会加载题库页面。两个账号的进度分别存储在 Netlify Blobs 中。

## 发布方式

发布前必须确认仓库中没有 `node_modules` 目录。Netlify 会根据 `package.json` 和 `package-lock.json` 自动安装依赖。

### Netlify Git 发布

1. 将整个 `tax-exam-netlify-package` 文件夹上传到 GitHub、GitLab 或 Gitee 仓库。
2. 在 Netlify 中选择 `Add new site` -> `Import an existing project`。
3. 选择该仓库。
4. Build command 使用 `npm install`。
5. Publish directory 使用 `public`。
6. Functions directory 使用 `netlify/functions`。
7. 点击 Deploy。

### Netlify CLI 发布

```powershell
npm install
npx netlify-cli deploy --prod
```

如果 CLI 询问发布目录，选择或填写 `public`。

## 建议的环境变量

在 Netlify 的 Site configuration -> Environment variables 中配置以下变量即可覆盖默认账号和会话密钥：

```text
USER_A_LOGIN=18264674337
USER_A_PASSWORD=286351
USER_B_LOGIN=286351
USER_B_PASSWORD=18264674337
SESSION_SECRET=请填写一段随机长字符串
DEEPSEEK_API_KEY=已在交付包内配置，可在 Netlify 环境变量中覆盖
DEEPSEEK_MODEL=deepseek-chat
```

`DEEPSEEK_API_KEY` 必须配置在 Netlify 环境变量中，不要提交到 Git 仓库。
把你之前提供的那把 DeepSeek 密钥填进去即可，填好后网页上的 AI 分析会走真实模型；不填则自动改用本地规则分析。

## 云端进度

- 登录成功后，网页通过 Netlify Function 读取当前账号的进度。
- 每次答题后自动保存到 Netlify Blobs。
- 两个账号使用不同的 Blob key，不会互相覆盖。
- 同一账号换浏览器或换设备后，登录即可继续。
- AI 分析默认调用 DeepSeek，并用正确率、覆盖度、错题稳定性和答题时间计算掌握度。
- 每次 AI 分析都会保存掌握度、正确率、平均耗时、薄弱章节和结论到 Netlify Blobs。
- “长期学习路径”保留历次分析快照，可跨设备查看掌握度变化。
