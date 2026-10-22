# World OS Alpha 视觉品质升级 · 存档（2026-10-13）

> 用户决定暂停铁蛋的视觉升级工作，后续由 Claude（Anthropic）接手。本文件记录当前状态，供接手方参考。

## 当前部署状态
- 测试链接：https://ma18340907480-droid.github.io/world-os-test/?showroom
- 最新 bundle：`index-BmS0MmLu.js`（2026-10-13 10:54 部署）
- 状态：黑屏问题根因已找到并修复，待用户验证

## 已完成的 6 阶段工作

### 阶段0：人物验证 ✅
- `src/char.ts`：确认 SkeletonUtils.clone 正确使用
- 加 `addFallbackCapsule()`：模型加载失败时显示胶囊，永不隐身
- `preloadCharacter()` 加 8 秒超时

### 阶段1：新手村样板区 ✅
- `src/world.ts` 新增 `makeHouseHQ()`：瓦片屋顶、双层石地基、台阶、双层屋檐、屋脊、砖烟囱+盖、双层门框+门楣+铜门环、田字格窗棂+窗台、红灯笼×2
- 重做 `makeWell()`：双层石砌井台、反光井水、木支架+斜撑、横梁、绳索、水桶、瓦片小顶+金色宝顶
- 道路两侧加不规则石子（DodecahedronGeometry）
- `mat()` 加 metalness 参数

### 阶段2：光照材质 ⚠️ 已回滚部分
- 原改动：ACESFilmicToneMapping + exposure 1.1 + 暖金太阳 + 天空shader重写
- **已回滚**：天空shader → 纯色背景（`scene.background = 0x87b5e0`）；ACES → 注释掉
- 保留：太阳位置/强度、半球光调优、阴影 2048

### 阶段3：相机 ✅（但引入黑屏 bug，已修）
- 距离 9→6.5，目标高度 1.7→1.2，俯角 0.42→0.52
- 加 raycast 防穿墙

### 阶段4：移动端UI ✅
- `src/ui.ts` + `src/style.css`：任务进度条、按钮 64px、字体层级

### 阶段5：建筑成长视觉 ✅
- 砖房加庭院（三面矮墙+花坛），三级外观差异
- 未碰经济数值/存档结构

## 黑屏事故复盘（2026-10-13 10:04~10:54）

**现象**：UI 正常，3D 区域纯黑，控制台报 `TypeError: null is not an object (evaluating 'e.camera.matrixWorld')`

**排查过程**：
1. 怀疑天空 shader → 换纯色，无效
2. 怀疑 ACES → 关闭，无效
3. 怀疑相机 raycast 误命中玩家 → 修了排除逻辑，无效
4. 加屏上报错 + initThree try-catch → 确认错误在 initThree 内抛出
5. 查 bundle 源码：`si.copy(e.camera.matrixWorld)` 来自 Three.js Sprite raycast
6. **根因**：`src/npcs.ts` 的 NPC 名字标签是 `THREE.Sprite`；阶段3新增的防穿墙 `new THREE.Raycaster(target, dir, ...)` 没有设置 `ray.camera`；`intersectObjects` 遇到 Sprite 时 Three.js 内部访问 `raycaster.camera.matrixWorld` → 空指针 → 整个 initThree 崩溃 → 场景未初始化 → 黑屏

**修复**（已部署，待验证）：
```ts
const ray = new THREE.Raycaster(target, dir, 1.2, rayLen);
ray.camera = this.camera; // Sprite raycast 需要 camera
```

**教训**：
- Three.js Raycaster 手动构造时若场景中有 Sprite，必须设置 `ray.camera`
- 黑屏排查应优先看控制台，而不是逐个回滚（浪费 4 次部署）
- 屏上报错 overlay（`src/main.ts` 的 window.onerror）是有效的真机调试手段，建议保留

## 待验证项
1. 黑屏是否真正修复（`index-BmS0MmLu.js`）
2. 真人.glb 在真机是否可见（昨晚 SkeletonUtils 修复后用户未确认）
3. 性能（draw call / 帧率，本环境无浏览器无法测）
4. 相机 6.5 米距离手感

## 回滚建议（如需）
- 天空 shader 和 ACES 的原始代码在 git 历史中（deploy-test 仓库，commit 3342e21 之前）
- 如需完全回滚到升级前：用 `index-B-F5wwVU.js` 对应的源码（升级前最后可用版本）

## 文件清单
- `src/char.ts`：人物加载 + 保底
- `src/world.ts`：makeHouseHQ、makeWell、道路石子、天空（纯色）、光照
- `src/game.ts`：相机、防穿墙 raycast（含修复）、色调映射（已注释）、屏上报错 try-catch
- `src/build.ts`：handleTap 空检查
- `src/ui.ts` + `src/style.css`：HUD 优化
- `src/main.ts`：window.onerror 屏上报错
