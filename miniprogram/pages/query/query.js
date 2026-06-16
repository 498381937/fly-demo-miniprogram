// pages/query/query.js
Page({
  data: {
    keyword: '',
    startDate: '',
    endDate: '',
    list: [],
    pageIndex: 0,
    pageSize: 20,
    total: 0,
    hasMore: true,
    loading: false,
    isAdmin: false,
    isInstructor: false,
    canViewAll: false,
    scope: 'mine', // 'mine' | 'all'
  },

  onShow() {
    this.refresh();
  },
  onLoad() {
    this.checkRole();
  },
  onPullDownRefresh() {
    this.refresh().then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadMore();
    }
  },

  // 查询当前用户角色信息
  checkRole() {
    wx.cloud
      .callFunction({ name: 'flylog', data: { action: 'who_am_i' } })
      .then((res) => {
        if (res.result && res.result.success) {
          const d = res.result.data;
          const isAdmin = !!d.isAdmin;
          const isInstructor = !isAdmin && d.role === 'instructor';
          this.setData({
            isAdmin,
            isInstructor,
            canViewAll: isAdmin || isInstructor,
          });
        }
      });
  },

  refresh() {
    this.setData({ pageIndex: 0, list: [], hasMore: true });
    return this.fetchList();
  },

  loadMore() {
    this.setData({ pageIndex: this.data.pageIndex + 1 });
    return this.fetchList(true);
  },

  fetchList(append = false) {
    this.setData({ loading: true });
    return wx.cloud
      .callFunction({
        name: 'flylog',
        data: {
          action: 'list',
          keyword: this.data.keyword,
          startDate: this.data.startDate,
          endDate: this.data.endDate,
          pageIndex: this.data.pageIndex,
          pageSize: this.data.pageSize,
          scope: this.data.scope,
        },
      })
      .then((res) => {
        this.setData({ loading: false });
        if (res.result && res.result.success) {
          const d = res.result.data;
          this.setData({
            list: append ? this.data.list.concat(d.list) : d.list,
            total: d.total,
            hasMore: d.hasMore,
            isAdmin: !!d.isAdmin,
            isInstructor: !!d.isInstructor,
            canViewAll: !!d.canViewAll,
            scope: d.scope || 'mine',
          });
        }
      })
      .catch(() => this.setData({ loading: false }));
  },

  onScopeChange(e) {
    const { scope } = e.currentTarget.dataset;
    if (scope === this.data.scope) return;
    this.setData({ scope });
    this.refresh();
  },

  onSearchChange(e) {
    this.setData({ keyword: e.detail.value });
  },
  onSearch() {
    this.refresh();
  },
  onStartDateChange(e) {
    this.setData({ startDate: e.detail.value });
    this.refresh();
  },
  onEndDateChange(e) {
    this.setData({ endDate: e.detail.value });
    this.refresh();
  },
  clearDates() {
    this.setData({ startDate: '', endDate: '' });
    this.refresh();
  },

  goDetail(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  goEdit(e) {
    const { id } = e.currentTarget.dataset;
    wx.reLaunch({ url: `/pages/report/report?id=${id}` });
  },

  onDelete(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复，确定继续吗？',
      confirmColor: '#e34d59',
      success: (r) => {
        if (r.confirm) {
          wx.showLoading({ title: '删除中', mask: true });
          wx.cloud
            .callFunction({
              name: 'flylog',
              data: { action: 'remove', _id: id },
            })
            .then((res) => {
              wx.hideLoading();
              if (res.result && res.result.success) {
                wx.showToast({ title: '已删除', icon: 'success' });
                this.refresh();
              } else {
                wx.showToast({ title: '删除失败', icon: 'none' });
              }
            })
            .catch(() => {
              wx.hideLoading();
              wx.showToast({ title: '网络异常', icon: 'none' });
            });
        }
      },
    });
  },
});
