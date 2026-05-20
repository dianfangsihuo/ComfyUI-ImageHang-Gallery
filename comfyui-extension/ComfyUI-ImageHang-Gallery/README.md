# ComfyUI Image Hang Gallery

Image Hang 的 ComfyUI 集成扩展。

## 功能

- 在 ComfyUI 右下角添加“画廊”按钮。
- 启动后可自动弹出画廊面板。
- 面板中可以查看、删除画廊图片。
- 可开启“自动收集生成图”，ComfyUI 节点执行完成后会把输出图片复制到画廊。

## 保存位置

数据保存到：

```text
ComfyUI/user/image_hang_gallery/gallery.json
ComfyUI/user/image_hang_gallery/images/
```

这样不会受浏览器缓存、浏览器 Profile、`localhost` / `127.0.0.1` 差异影响。

## 结构

```text
ComfyUI-ImageHang-Gallery/
  __init__.py                  后端路由和本地文件保存
  web/image_hang_gallery.js    ComfyUI 前端面板
  README.md
```

## 后续集成方向

- 把 Image Hang 的 3D 画廊 React 构建产物接入同一份 `gallery.json`。
- 在面板里加入“发送到 3D 画廊 / 挂到墙上”的布局管理。
- 增加一个显式节点，允许某个工作流分支单独控制是否存入画廊。
