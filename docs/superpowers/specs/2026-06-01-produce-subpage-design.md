# Produce 子页设计 — MatrixOmnix Landing

日期：2026-06-01
范围：`landing-app`（Vue 单文件落地页）

## 目标

在 MatrixOmnix 总落地页新增一个 **Produce** 导航子页，把 MatrixOmnix 家族产品做成卡片。有线上主页的产品用 iframe 内嵌「活页面预览」，没有线上主页的产品给轻量文字 + GitHub 链接卡。

## 决策（来自 brainstorming）

1. **产品范围**：Hub + Paper 用活页面内嵌卡；Forge + Arena 仅链接卡（文字 + GitHub）。
2. **活卡交互**：缩小活预览 + 点击新标签页打开完整站点。iframe 按较大逻辑宽度加载后 `transform: scale()` 缩小填满卡片，卡内 `pointer-events: none` 不可交互，hover 浮出 `Open live →`。
3. **可行性已验证**：`matrixomnix-hub.vercel.app` 与 `matrixomnixpaper.vercel.app` 均返回 200，且无 `X-Frame-Options` / CSP `frame-ancestors`，可被内嵌。

## 实现

### 路由与导航
- `navItems` 增加 `{ id: 'produce', label: 'Produce' }`，置于 About 之后、Service 之前。
- `routeFromPath()` 已基于 `navItems` 匹配，`/produce` 自动可达，无需改路由逻辑。
- 模板新增 `v-else-if="page === 'produce'"` 段。
- `vercel.json` 的 `rewrites` 增加 `{ "source": "/produce", "destination": "/index.html" }`，保证直链/刷新不 404。

### 页面结构
- 顶部 `PageHeading`（kicker `Produce`）。
- 卡片网格分两组：
  - **活预览卡 ×2（Hub、Paper）**：固定高度预览框 + 标题 + 一句简介 + ghost GitHub 链接；预览框内 iframe 以 1280px 逻辑宽度加载，按比例缩放填满。hover 浮出「Open live →」覆盖层，点击新标签页打开。
  - **仅源码卡 ×2（Forge、Arena）**：复用 `.project-card` 风格，kicker 标「CLI · 仅源码」，标题 + 简介 + GitHub 链接。

### 性能：懒加载
- iframe 用 `IntersectionObserver` 懒加载：卡片进入视口才设置 `src`，未进入时显示占位（产品图标/骨架）。避免进入 Produce 页一次性拉起两个完整 app。
- 离开 Produce 页（切到其他 page）时卸载 iframe，避免后台常驻两个 app。

### 改动文件
- `landing-app/src/App.vue`：navItems、produce 模板段、懒加载逻辑。
- `landing-app/src/style.css`：`.produce-*` / 缩放预览框样式 + 响应式。
- `vercel.json`：新增 `/produce` rewrite。
- 不引入新依赖。

## 验收
- 本地 `pnpm --dir landing-app build` 通过。
- 导航点击 Produce 切换正常；`/produce` 直链刷新不 404（部署后）。
- 两张活卡能看到 Hub/Paper 真实主页的缩小预览，点击在新标签页打开完整站。
- 两张仅源码卡正确指向各自 GitHub。
