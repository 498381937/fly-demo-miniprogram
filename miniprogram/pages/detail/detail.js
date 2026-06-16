// pages/detail/detail.js
Page({
  data: {
    id: '',
    detail: null,
    loading: true,
    readonly: false,
  },

  onLoad(options) {
    if (!options || !options.id) {
      wx.showToast({ title: '缺少 id', icon: 'none' });
      return;
    }
    this.setData({
      id: options.id,
      readonly: options.readonly === '1',
    });
    this.loadDetail();
  },

  loadDetail() {
    this.setData({ loading: true });
    wx.cloud
      .callFunction({
        name: 'flylog',
        data: { action: 'detail', _id: this.data.id },
      })
      .then((res) => {
        this.setData({ loading: false });
        if (res.result && res.result.success && res.result.data) {
          this.setData({ detail: res.result.data });
        } else {
          wx.showToast({ title: '日志不存在', icon: 'none' });
        }
      })
      .catch(() => this.setData({ loading: false }));
  },

  onEdit() {
    // 填报页是 tabBar 页面，redirectTo/navigateTo 不支持跳转到 tabBar
    // 这里使用 reLaunch：关闭所有页面后打开目标页，可以携带 query 参数
    wx.reLaunch({ url: `/pages/report/report?id=${this.data.id}` });
  },

  onDelete() {
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复，确定继续吗？',
      confirmColor: '#e34d59',
      success: (r) => {
        if (!r.confirm) return;
        wx.showLoading({ title: '删除中', mask: true });
        wx.cloud
          .callFunction({
            name: 'flylog',
            data: { action: 'remove', _id: this.data.id },
          })
          .then((res) => {
            wx.hideLoading();
            if (res.result && res.result.success) {
              wx.showToast({ title: '已删除', icon: 'success' });
              setTimeout(() => wx.navigateBack(), 600);
            } else {
              wx.showToast({ title: '删除失败', icon: 'none' });
            }
          })
          .catch(() => {
            wx.hideLoading();
            wx.showToast({ title: '网络异常', icon: 'none' });
          });
      },
    });
  },

  onShareAppMessage() {
    return {
      title: `飞行日志 ${this.data.detail && this.data.detail.logCode}`,
      path: `/pages/detail/detail?id=${this.data.id}`,
    };
  },
});
