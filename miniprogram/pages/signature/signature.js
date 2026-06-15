// pages/signature/signature.js
Page({
  data: {
    hasDrawn: false,
  },

  onReady() {
    this.ctx = wx.createCanvasContext('signCanvas', this);
    this.ctx.setLineWidth(4);
    this.ctx.setLineCap('round');
    this.ctx.setLineJoin('round');
    this.ctx.setStrokeStyle('#222');
  },

  onTouchStart(e) {
    const t = e.touches[0];
    this.lastX = t.x;
    this.lastY = t.y;
    this.ctx.beginPath();
    this.ctx.moveTo(t.x, t.y);
    this.setData({ hasDrawn: true });
  },

  onTouchMove(e) {
    const t = e.touches[0];
    this.ctx.moveTo(this.lastX, this.lastY);
    this.ctx.lineTo(t.x, t.y);
    this.ctx.stroke();
    this.ctx.draw(true);
    this.lastX = t.x;
    this.lastY = t.y;
  },

  clear() {
    const query = wx.createSelectorQuery().in(this);
    query
      .select('#signCanvas')
      .boundingClientRect((rect) => {
        if (!rect) return;
        this.ctx.clearRect(0, 0, rect.width, rect.height);
        this.ctx.draw();
        this.setData({ hasDrawn: false });
      })
      .exec();
  },

  save() {
    if (!this.data.hasDrawn) {
      wx.showToast({ title: '请先签名', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '保存中', mask: true });
    wx.canvasToTempFilePath(
      {
        canvasId: 'signCanvas',
        fileType: 'png',
        success: (res) => {
          wx.hideLoading();
          const eventChannel = this.getOpenerEventChannel();
          if (eventChannel && eventChannel.emit) {
            eventChannel.emit('signatureReturn', { url: res.tempFilePath });
          }
          wx.navigateBack();
        },
        fail: () => {
          wx.hideLoading();
          wx.showToast({ title: '保存失败', icon: 'none' });
        },
      },
      this,
    );
  },
});
