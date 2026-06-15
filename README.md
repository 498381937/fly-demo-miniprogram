# 多旋翼无人机飞行云日志填报微信小程序

基于需求文档《多旋翼无人机飞行云日志填报界面（成品可用版+微信小程序适配）》开发的微信小程序。
使用 **微信小程序原生框架 + TDesign 小程序组件库 + 微信云开发**。

## 云开发环境

| 项目 | 值 |
| ---- | -- |
| 云环境 ID | `cloud1-d1goamb98422359ec` |
| 地域 | 微信云开发（通过微信开发者工具管理） |
| 云函数 | `flylog`（需在微信开发者工具手动部署） |
| 数据库集合 | `flight_logs` / `users` / `admins` |

## 功能概览

| 页面 | 说明 |
| ---- | ---- |
| 首页 `pages/index` | 飞行总览卡片、快捷操作、最近 5 条日志 |
| 填报日志 `pages/report` | 3 个 Tab（基础信息 / 飞行数据 / 异常与备注），必填校验、自动计算时长、定位、手写签名、草稿保存与恢复、模拟同步飞控数据 |
| 手写签名 `pages/signature` | Canvas 手写签名，导出临时图片返回填报页 |
| 日志查询 `pages/query` | 关键词搜索、日期区间筛选、分页加载、查看/编辑/删除 |
| 日志详情 `pages/detail` | 完整字段展示，支持编辑 / 删除 / 分享 |
| 数据统计 `pages/stats` | 累计架次与总时长、近 7 天柱状图、按机型/任务类型分布 |
| 个人中心 `pages/profile` | 昵称头像、常用信息预填、清除草稿 |

## 目录结构

```
fly-demo/
├── project.config.json
├── project.private.config.json
├── miniprogram/
│   ├── app.js / app.json / app.wxss
│   ├── sitemap.json
│   ├── package.json                # TDesign 依赖声明
│   ├── utils/
│   │   ├── util.js                 # 通用时间格式化、日志编号生成
│   │   └── tools.wxs
│   ├── styles/
│   │   └── iconfont.wxss
│   └── pages/
│       ├── index/                  # 首页
│       ├── report/                 # 填报日志（3 Tab）
│       ├── signature/              # 手写签名
│       ├── query/                  # 日志查询
│       ├── detail/                 # 日志详情
│       ├── stats/                  # 数据统计
│       └── profile/                # 个人中心
└── cloudfunctions/
    └── flylog/                     # 唯一云函数，通过 action 分发
        ├── index.js
        └── package.json
```

## 运行步骤

### 1. 开通云开发
1. 使用微信开发者工具打开项目根目录 `fly-demo`（选择 **不使用模板/空白** 打开）。
2. 在工具菜单「云开发」中开通一个云开发环境，得到 **云环境 ID**。
3. 打开 `miniprogram/app.js`，将 `globalData.envId` 中的 `your-cloud-env-id` 替换为你的真实环境 ID。

### 2. 构建 npm（安装 TDesign）
在微信开发者工具里：
1. 进入「详情 → 本地设置」：
   - 勾选「使用 npm 模块」
2. 进入 `miniprogram` 目录执行 `npm install`（或在开发者工具里点击「工具 → 构建 npm」）。
3. 提前在终端执行：
   ```bash
   cd miniprogram
   npm install
   ```
   然后回到开发者工具点击 **工具 → 构建 npm**。

### 3. 部署云函数
1. 在开发者工具左侧文件树右键 `cloudfunctions/flylog`，选择 **在终端中打开**，执行：
   ```bash
   npm install
   ```
2. 再次右键 `cloudfunctions/flylog`，选择 **上传并部署：云端安装依赖**。

### 4. 初始化云数据库（一次即可）
首次调用云函数 `create` 时会自动创建集合 `flight_logs`；也可以到云开发控制台 → 数据库，手动新建集合 `flight_logs`，权限选择：**仅创建者可读写**。

字段说明（自动写入）：

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `_openid` | string | 自动，数据属主 |
| `logCode` | string | 日志编号 FLY-YYYYMMDD-NNN |
| `dateKey` | string | YYYYMMDD 便于索引 |
| `flightDate` | string | 飞行日期 YYYY-MM-DD |
| `takeoffTime` / `landingTime` | string | HH:MM:SS |
| `totalDuration` / `durationSeconds` | string / number | 时长字符串与秒 |
| `pilotName` / `pilotId` / `className` / `teacher` | string | 驾驶员信息 |
| `droneModel` / `bodySn` / `batterySn` | string | 无人机信息 |
| `missionType` | string | 任务类型 |
| `takeoffLocation` / `landingLocation` / `airspaceCode` | string | 地点与空域 |
| `maxAltitude` / `maxHorizontalSpeed` / `maxVerticalSpeed` | number | 飞行极值 |
| `takeoffSoc` / `landingSoc` | number | 起/降 SOC |
| `flightMode` / `hoverAccuracy` / `weather` | string | 飞行状态 |
| `warningLog` / `emergencyLog` | string | 告警/应急记录 |
| `preCheckResult` | string | 合格 / 不合格 |
| `teacherComment` / `signatureImage` | string | 评语与签名（签名为临时/云存储 URL） |
| `createTime` / `updateTime` | date | 时间戳 |

> 建议在集合 `flight_logs` 上创建 `flightDate` 与 `_openid` 的联合索引以优化查询：云开发控制台 → 数据库 → 索引。

### 5. 真机预览
- 开发者工具 → 预览，扫描二维码即可在微信里体验。
- 首次使用会请求定位授权（用于起飞/降落地点坐标），请同意。

## 云函数 API（`flylog`）

所有操作通过 `wx.cloud.callFunction({ name: 'flylog', data: { action: '...' } })` 发起。

| action | 入参 | 说明 |
| ------ | ---- | ---- |
| `gen_code` | `{ flightDate }` | 生成当日下一个日志编号 |
| `create` | `{ data }` | 新增日志（自动生成编号、时长秒） |
| `update` | `{ _id, data }` | 更新日志 |
| `remove` | `{ _id }` | 删除日志 |
| `detail` | `{ _id }` | 查询单条详情 |
| `list` | `{ keyword, startDate, endDate, pageIndex, pageSize }` | 列表分页查询 |
| `stats` | 无 | 统计数据（总架次/时长/按机型/按任务/近7日） |

## 兼容性说明

- **需要基础库 ≥ 2.20.0**（使用了云开发与 TDesign 组件）。
- 使用了 `chooseAvatar` 与 `type="nickname"` 的新用户信息获取方式，无需 `wx.getUserProfile`。
- 所有数据默认隔离到当前 `openid`，保障用户数据互不可见；如需多角色（教师查看学生）请扩展云函数。

## 需求对应点

- ✅ 3 个 Tab（基础 / 飞行数据 / 异常与备注）均已实现
- ✅ 自动生成日志编号 `FLY-YYYYMMDD-NNN`
- ✅ 起降时间选择 + 自动计算总飞行时长
- ✅ 无人机型号/任务类型/飞行模式/检查结果下拉选择
- ✅ 起飞/降落地点：一键获取当前经纬度
- ✅ 同步飞控数据按钮（演示：1.5 s 后填充示例数据）
- ✅ 告警/应急多行文本、教师评语
- ✅ 飞行前检查不合格禁止提交
- ✅ 手写电子签名（Canvas）
- ✅ 草稿保存（本地缓存）+ 恢复提示
- ✅ 日志查询、编辑、删除
- ✅ 统计图表（柱状 + 分布条）

## 自定义拓展建议

1. **教师端查看学生日志**：新增角色表 + 云函数 `action: 'list_by_class'`，对指导教师放开查询权限。
2. **签名上传到云存储**：在填报页 `onSubmit` 前，用 `wx.cloud.uploadFile` 把 `signatureImage` 的临时路径上传，并将返回的 `fileID` 写入数据库，确保离线可访问。
3. **Excel 导出**：新增云函数使用 `node-xlsx` / `exceljs` 按需求文档表头导出。
4. **飞控数据对接**：将 `onSyncFlightData` 改为调用真实 SDK 或 HTTP 接口获取数据。

