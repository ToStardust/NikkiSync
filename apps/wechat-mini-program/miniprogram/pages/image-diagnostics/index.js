const { parseEncryptedImageQr, runEncryptedImageProbe } = require('../../lib/encrypted-probe.js');
let sequence = 0;
Page({
  data: { busy: false, saving: false, previewReady: false, imagePath: '', message: '仅传输本机生成的四色测试图，不读取真实照片。' },
  onLoad() { this._alive = true; this._generation = 0; },
  onShow() { this._active = true; if (this._pending) { const config = this._pending; this._pending = null; this.startTest(config); } },
  onHide() { this._active = false; if (this._cancel) this._cancel(); if (this._alive && !this._scanning) this.setData({ busy: false }); },
  onUnload() { this._alive = false; this._active = false; this._pending = null; this._generation++; if (this._cancel) this._cancel(); this.clearImage(); },
  removeCache(path) { if (path) { try { wx.getFileSystemManager().unlink({ filePath: path, fail() {} }); } catch (_) {} } },
  clearImage() { const path = this._file; this._file = null; if (path !== this._savingFile) this.removeCache(path); if (this._alive) this.setData({ imagePath: '', previewReady: false }); },
  imageLoaded() { if (this._alive && this._file) this.setData({ previewReady: true }); },
  imageFailed() { if (!this._alive || this.data.saving) return; this.clearImage(); this.setData({ message: '测试图片无法显示，未保存相册。' }); },
  scanTest() {
    if (!this._alive || !this._active || this.data.busy || this.data.saving) return;
    this._scanning = true; this.setData({ busy: true, message: '请扫描电脑的图片专用加密测试码。' });
    wx.scanCode({ onlyFromCamera: true, scanType: ['qrCode'], success: result => {
      this._scanning = false; if (!this._alive) return; let config;
      try { config = parseEncryptedImageQr(result.result); } catch (_) { this.setData({ busy: false, message: '图片测试码无效或过期，请勿使用文本测试码。' }); return; }
      if (!this._active) { this._pending = config; return; } this.startTest(config);
    }, fail: () => { this._scanning = false; if (this._alive) this.setData({ busy: false, message: '扫码取消或失败。' }); } });
  },
  startTest(config) {
    if (!this._alive || !this._active) return;
    if (this._cancel) this._cancel(); this.clearImage(); const generation = ++this._generation;
    this.setData({ busy: true, message: '正在接收并校验加密合成图片…' });
    this._cancel = runEncryptedImageProbe(wx, config, value => {
      if (!this._alive || !this._active || generation !== this._generation) { if (value.image) value.image.fill(0); return; }
      if (value.status !== 'ok') { this.setData({ busy: false, message: value.message }); return; }
      const path = wx.env.USER_DATA_PATH + '/nikkisync-synthetic-' + Date.now() + '-' + (++sequence) + '.png';
      // Only a verified fixed fixture can reach this write. Never accept a remote filename/path.
      const bytes = value.image.slice(); value.image.fill(0);
      try {
        wx.getFileSystemManager().writeFile({ filePath: path, data: bytes.buffer,
          success: () => {
            bytes.fill(0);
            if (!this._alive || generation !== this._generation || !this._active) { this.removeCache(path); if (this._alive) this.setData({ busy: false }); return; }
            this._file = path; this.setData({ busy: false, imagePath: path, message: '完整性校验通过。请先查看四色测试图，再决定是否保存。' });
          }, fail: () => { bytes.fill(0); this.removeCache(path); if (this._alive && generation === this._generation) this.setData({ busy: false, message: '本地预览文件写入失败，未保存相册。' }); }
        });
      } catch (_) { bytes.fill(0); this.removeCache(path); this.setData({ busy: false, message: '本地预览不可用，未保存相册。' }); }
    });
  },
  discardImage() { if (this.data.saving || this.data.busy) return; this.clearImage(); this.setData({ message: '已取消，只清除本次预览缓存，不删除相册图片。' }); },
  saveImage() {
    if (!this._alive || !this._active || !this._file || !this.data.previewReady || this.data.saving || this.data.busy) return;
    this.setData({ saving: true, message: '正在请求保存测试图…' });
    const path = this._file; this._savingFile = path; let settled = false;
    const finish = message => { if (settled) return; settled = true; this._savingFile = null;
      if (!this._alive || this._file !== path) this.removeCache(path);
      if (this._alive) this.setData({ saving: false, message }); };
    const failed = () => finish('未保存：可能取消了授权或相册写入失败。可重试，不会自动打开设置。');
    try { wx.saveImageToPhotosAlbum({ filePath: path,
      success: () => finish('测试图已保存到系统相册，请到相册核对。真实照片和 iPhone 仍未验收。'), fail: failed }); }
    catch (_) { failed(); }
  }
});
