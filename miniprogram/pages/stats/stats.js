// pages/stats/stats.js
Page({
  data: {
    loading: true,
    stats: null,
    maxDaily: 1,
    isAdmin: false,
    scope: 'mine', // 'mine' | 'all'
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  onScopeChange(e) {
    const { scope } = e.currentTarget.dataset;
    if (scope === this.data.scope) return;
    this.setData({ scope });
    this.load();
  },

  load() {
    this.setData({ loading: true });
    return wx.cloud
      .callFunction({
        name: 'flylog',
        data: { action: 'stats', scope: this.data.scope },
      })
      .then((res) => {
        this.setData({ loading: false });
        if (res.result && res.result.success) {
          const stats = res.result.data;
          const maxDaily = Math.max(
            1,
            ...(stats.daily || []).map((d) => d.count),
          );
          this.setData({
            stats,
            maxDaily,
            isAdmin: !!stats.isAdmin,
            scope: stats.scope || 'mine',
          });
        }
      })
      .catch(() => this.setData({ loading: false }));
  },
});
