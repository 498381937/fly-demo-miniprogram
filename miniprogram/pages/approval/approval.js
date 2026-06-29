// pages/approval/approval.js
// 通用审批页，支持两种审批类型（通过顶部 Tab 切换）：
//   type=log  - 日志审批（安全员/教师/管理员）
//   type=user - 用户注册审批（仅管理员可见）

// ============ 日志审批状态 ============
const LOG_STATUS = {
  PENDING_SAFETY: 'pending_safety',
  PENDING_INSTRUCTOR: 'pending_instructor',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

const LOG_STATUS_CONFIG = {
  [LOG_STATUS.PENDING_SAFETY]: { label: '待安全员审批', color: '#fa8c16' },
  [LOG_STATUS.PENDING_INSTRUCTOR]: { label: '待教师审批', color: '#1890ff' },
  [LOG_STATUS.APPROVED]: { label: '已通过', color: '#52c41a' },
  [LOG_STATUS.REJECTED]: { label: '已驳回', color: '#ff4d4f' },
};

// ============ 用户审批状态 ============
const USER_STATUS_CONFIG = {
  pending: { label: '待审批', color: '#fa8c16' },
  approved: { label: '已通过', color: '#52c41a' },
  rejected: { label: '已驳回', color: '#ff4d4f' },
};

Page({
  data: {
    // 当前用户信息
    isAdmin: false,
    userRole: 'student',
    userRealName: '',
    userOpenid: '',     // 当前用户 openid，用于审批权限比对

    // 顶层类型 Tab（日志审批 / 用户审批）
    typeTabIndex: 0,        // 0=日志审批, 1=用户注册审批（仅管理员可见）
    showUserTab: false,     // 是否展示用户审批 Tab

    // 视图模式：list | detail
    viewMode: 'list',

    // ---- 日志审批列表 ----
    logList: [],
    logTotal: 0,
    logPageIndex: 0,
    logPageSize: 15,
    logHasMore: false,
    logLoading: false,

    // 日志筛选 Tab
    logFilterTabs: [],
    logActiveFilterIndex: 0,
    logFilterStatus: '',

    // ---- 用户审批列表 ----
    userList: [],
    userTotal: 0,
    userPageIndex: 0,
    userPageSize: 15,
    userHasMore: false,
    userLoading: false,

    userFilterTabs: [
      { label: '待审批', status: 'pending' },
      { label: '已驳回', status: 'rejected' },
    ],
    userActiveFilterIndex: 0,
    userFilterStatus: 'pending',

    // ---- 当前详情 ----
    currentType: 'log',     // 'log' | 'user'
    currentItem: null,
    detailLoading: false,

    // ---- 审批操作 ----
    approveComment: '',
    rejectComment: '',
    showApproveDialog: false,
    showRejectDialog: false,
    operating: false,
    approveConfirmBtn: { content: '确认通过', theme: 'primary' },
    rejectConfirmBtn: { content: '确认驳回', theme: 'danger' },

    // ---- 一键审批 ----
    showBatchApproveDialog: false,   // 二次确认弹窗
    batchPendingList: [],            // 待批列表摘要
    batchApproving: false,           // 批量审批进行中
    batchConfirmBtn: { content: '全部审批通过', theme: 'primary' },
  },

  onLoad() {
    this.fetchUserInfo();
  },

  onShow() {
    if (this.data.userRole) {
      this._refreshCurrentTab();
    }
  },

  onPullDownRefresh() {
    this._refreshCurrentTab(() => wx.stopPullDownRefresh());
  },

  fetchUserInfo() {
    wx.showLoading({ title: '加载中', mask: false });
    wx.cloud
      .callFunction({ name: 'flylog', data: { action: 'who_am_i' } })
      .then((res) => {
        wx.hideLoading();
        if (res.result && res.result.success) {
          const d = res.result.data;
          const isAdmin = !!d.isAdmin;
          const userRole = d.role || 'student';
          const logFilterTabs = this._buildLogFilterTabs(isAdmin, userRole);

          this.setData({
            isAdmin,
            userRole,
            userRealName: d.realName || '',
            userOpenid: d.openid || '',
            showUserTab: isAdmin,
            logFilterTabs,
            logActiveFilterIndex: 0,
            logFilterStatus: logFilterTabs.length > 0 ? logFilterTabs[0].status : '',
          });
          this.loadLogList();
        } else {
          wx.showToast({ title: '获取用户信息失败', icon: 'none' });
        }
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '网络异常', icon: 'none' });
      });
  },

  _buildLogFilterTabs(isAdmin, userRole) {
    if (isAdmin) {
      return [
        { label: '全部待审批', status: '' },
        { label: '待安全员', status: LOG_STATUS.PENDING_SAFETY },
        { label: '待教师', status: LOG_STATUS.PENDING_INSTRUCTOR },
        { label: '已驳回', status: LOG_STATUS.REJECTED },
      ];
    }
    // 非管理员（学员/教师都可能作为安全员）：统一展示
    if (userRole === 'instructor') {
      // 教师还可能作为教师审批
      return [
        { label: '待我审批', status: '' },
        { label: '待安全员审批', status: LOG_STATUS.PENDING_SAFETY },
        { label: '待教师审批', status: LOG_STATUS.PENDING_INSTRUCTOR },
        { label: '已驳回', status: LOG_STATUS.REJECTED },
      ];
    }
    // 学员：可能作为安全员审批，也能查自己日志进度
    return [
      { label: '待我审批', status: '' },
      { label: '已驳回', status: LOG_STATUS.REJECTED },
    ];
  },

  // ============ 顶层类型 Tab 切换 ============
  onTypeTabChange(e) {
    const idx = Number(e.currentTarget.dataset.index);
    if (idx === this.data.typeTabIndex) return;
    this.setData({ typeTabIndex: idx, viewMode: 'list', currentItem: null });
    if (idx === 0) {
      this._resetLogList();
    } else {
      this._resetUserList();
    }
  },

  _refreshCurrentTab(callback) {
    if (this.data.typeTabIndex === 0) {
      this._resetLogList(callback);
    } else {
      this._resetUserList(callback);
    }
  },

  // ============ 日志审批列表 ============
  onLogFilterTabChange(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const tab = this.data.logFilterTabs[idx];
    if (!tab) return;
    this.setData({ logActiveFilterIndex: idx, logFilterStatus: tab.status });
    this._resetLogList();
  },

  _resetLogList(callback) {
    this.setData({ logList: [], logPageIndex: 0, logHasMore: false });
    this.loadLogList(callback);
  },

  loadLogList(callback) {
    if (this.data.logLoading) return;
    this.setData({ logLoading: true });

    wx.cloud
      .callFunction({
        name: 'flylog',
        data: {
          action: 'list_approvals',
          pageIndex: this.data.logPageIndex,
          pageSize: this.data.logPageSize,
          approvalStatus: this.data.logFilterStatus,
        },
      })
      .then((res) => {
        this.setData({ logLoading: false });
        if (callback) callback();

        if (res.result && res.result.success) {
          const d = res.result.data;
          const formatted = (d.list || []).map((item) => ({
            ...item,
            _statusConfig: LOG_STATUS_CONFIG[item.approvalStatus] || { label: item.approvalStatus, color: '#999' },
            _canApprove: this._canApproveLog(item, d.isAdmin),
          }));
          this.setData({
            logList: this.data.logPageIndex === 0 ? formatted : [...this.data.logList, ...formatted],
            logTotal: d.total || 0,
            logHasMore: d.hasMore || false,
          });
        } else {
          wx.showToast({ title: (res.result && res.result.message) || '加载失败', icon: 'none' });
        }
      })
      .catch(() => {
        this.setData({ logLoading: false });
        if (callback) callback();
        wx.showToast({ title: '网络异常', icon: 'none' });
      });
  },

  onLogLoadMore() {
    if (!this.data.logHasMore || this.data.logLoading) return;
    this.setData({ logPageIndex: this.data.logPageIndex + 1 });
    this.loadLogList();
  },

  // 判断当前用户是否可审批某条日志
  // 优先用 safetyOfficerOpenid / teacherOpenid 字段（精确），兼容旧数据用 realName
  // 管理员：任意待审批状态均可操作
  _canApproveLog(item, isAdmin) {
    if (isAdmin) {
      return item.approvalStatus === LOG_STATUS.PENDING_SAFETY
        || item.approvalStatus === LOG_STATUS.PENDING_INSTRUCTOR;
    }
    const myOpenid = this.data.userOpenid;
    const myName = this.data.userRealName;

    const isSafetyOfficer = item.approvalStatus === LOG_STATUS.PENDING_SAFETY
      && (
        (item.safetyOfficerOpenid && myOpenid && item.safetyOfficerOpenid === myOpenid)
        || (!item.safetyOfficerOpenid && myName && item.safetyOfficer === myName)
      );
    const isTeacher = item.approvalStatus === LOG_STATUS.PENDING_INSTRUCTOR
      && (
        (item.teacherOpenid && myOpenid && item.teacherOpenid === myOpenid)
        || (!item.teacherOpenid && myName && item.teacher === myName)
      );

    return isSafetyOfficer || isTeacher;
  },

  // ============ 用户审批列表 ============
  onUserFilterTabChange(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const tab = this.data.userFilterTabs[idx];
    if (!tab) return;
    this.setData({ userActiveFilterIndex: idx, userFilterStatus: tab.status });
    this._resetUserList();
  },

  _resetUserList(callback) {
    this.setData({ userList: [], userPageIndex: 0, userHasMore: false });
    this.loadUserList(callback);
  },

  loadUserList(callback) {
    if (this.data.userLoading || !this.data.isAdmin) return;
    this.setData({ userLoading: true });

    wx.cloud
      .callFunction({
        name: 'flylog',
        data: {
          action: 'list_user_approvals',
          pageIndex: this.data.userPageIndex,
          pageSize: this.data.userPageSize,
          approvalStatus: this.data.userFilterStatus,
        },
      })
      .then((res) => {
        this.setData({ userLoading: false });
        if (callback) callback();

        if (res.result && res.result.success) {
          const d = res.result.data;
          const formatted = (d.list || []).map((item) => ({
            ...item,
            _statusConfig: USER_STATUS_CONFIG[item.userApprovalStatus] || { label: item.userApprovalStatus, color: '#999' },
          }));
          this.setData({
            userList: this.data.userPageIndex === 0 ? formatted : [...this.data.userList, ...formatted],
            userTotal: d.total || 0,
            userHasMore: d.hasMore || false,
          });
        } else {
          wx.showToast({ title: (res.result && res.result.message) || '加载失败', icon: 'none' });
        }
      })
      .catch(() => {
        this.setData({ userLoading: false });
        if (callback) callback();
        wx.showToast({ title: '网络异常', icon: 'none' });
      });
  },

  onUserLoadMore() {
    if (!this.data.userHasMore || this.data.userLoading) return;
    this.setData({ userPageIndex: this.data.userPageIndex + 1 });
    this.loadUserList();
  },

  // ============ 进入详情 ============
  onLogItemTap(e) {
    const { id } = e.currentTarget.dataset;
    const item = this.data.logList.find((i) => i._id === id);
    if (!item) return;
    this.setData({ viewMode: 'detail', currentType: 'log', currentItem: item });
    this._loadLogDetail(id);
  },

  _loadLogDetail(id) {
    this.setData({ detailLoading: true });
    wx.cloud
      .callFunction({ name: 'flylog', data: { action: 'detail', _id: id } })
      .then((res) => {
        this.setData({ detailLoading: false });
        if (res.result && res.result.success && res.result.data) {
          const d = res.result.data;
          this.setData({
            currentItem: {
              ...d,
              _statusConfig: LOG_STATUS_CONFIG[d.approvalStatus] || { label: d.approvalStatus, color: '#999' },
              _canApprove: this._canApproveLog(d, this.data.isAdmin),
            },
          });
        }
      })
      .catch(() => this.setData({ detailLoading: false }));
  },

  onUserItemTap(e) {
    const { openid } = e.currentTarget.dataset;
    const item = this.data.userList.find((i) => i.openid === openid);
    if (!item) return;
    this.setData({ viewMode: 'detail', currentType: 'user', currentItem: item });
  },

  backToList() {
    this.setData({ viewMode: 'list', currentItem: null });
  },

  // ============ 弹窗控制 ============
  onApproveCommentInput(e) {
    this.setData({ approveComment: e.detail.value });
  },

  onRejectCommentInput(e) {
    console.log('onRejectCommentInput', e.detail.value);
    this.setData({ rejectComment: e.detail.value });
  },

  showApproveConfirm() {
    this.setData({ showApproveDialog: true, approveComment: '' });
  },

  showRejectConfirm() {
    this.setData({ showRejectDialog: true, rejectComment: '' });
  },

  closeApproveDialog() {
    this.setData({ showApproveDialog: false });
  },

  closeRejectDialog() {
    this.setData({ showRejectDialog: false });
  },

  // ============ 审批操作（日志 + 用户通用）============
  doApprove() {
    if (this.data.operating) return;
    const { currentItem, currentType, approveComment } = this.data;
    if (!currentItem) return;

    this.setData({ operating: true, showApproveDialog: false });
    wx.showLoading({ title: '审批中', mask: true });

    const action = currentType === 'user' ? 'approve_user' : 'approve';
    const callData = currentType === 'user'
      ? { action, targetOpenid: currentItem.openid, comment: approveComment }
      : { action, _id: currentItem._id, comment: approveComment };

    wx.cloud
      .callFunction({ name: 'flylog', data: callData })
      .then((res) => {
        wx.hideLoading();
        this.setData({ operating: false });
        if (res.result && res.result.success) {
          wx.showToast({ title: '审批通过', icon: 'success' });
          if (currentType === 'user') {
            this.setData({
              'currentItem.userApprovalStatus': 'approved',
              'currentItem._statusConfig': USER_STATUS_CONFIG.approved,
            });
            this._resetUserList();
          } else {
            const nextStatus = res.result.data.approvalStatus;
            this.setData({
              'currentItem.approvalStatus': nextStatus,
              'currentItem._statusConfig': LOG_STATUS_CONFIG[nextStatus] || { label: nextStatus, color: '#999' },
              'currentItem._canApprove': false,
            });
            this._resetLogList();
          }
        } else {
          wx.showToast({ title: (res.result && res.result.message) || '操作失败', icon: 'none' });
        }
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ operating: false });
        wx.showToast({ title: '网络异常', icon: 'none' });
      });
  },

  doReject() {
    if (this.data.operating) return;
    const { currentItem, currentType, rejectComment } = this.data;
    if (!currentItem) return;
    if (!rejectComment.trim()) {
      wx.showToast({ title: '请填写驳回原因', icon: 'none' });
      return;
    }

    this.setData({ operating: true, showRejectDialog: false });
    wx.showLoading({ title: '提交中', mask: true });

    const action = currentType === 'user' ? 'reject_user' : 'reject';
    const callData = currentType === 'user'
      ? { action, targetOpenid: currentItem.openid, comment: rejectComment }
      : { action, _id: currentItem._id, comment: rejectComment };

    wx.cloud
      .callFunction({ name: 'flylog', data: callData })
      .then((res) => {
        wx.hideLoading();
        this.setData({ operating: false });
        if (res.result && res.result.success) {
          wx.showToast({ title: '已驳回', icon: 'success' });
          if (currentType === 'user') {
            this.setData({
              'currentItem.userApprovalStatus': 'rejected',
              'currentItem._statusConfig': USER_STATUS_CONFIG.rejected,
            });
            this._resetUserList();
          } else {
            this.setData({
              'currentItem.approvalStatus': LOG_STATUS.REJECTED,
              'currentItem._statusConfig': LOG_STATUS_CONFIG[LOG_STATUS.REJECTED],
              'currentItem._canApprove': false,
            });
            this._resetLogList();
          }
        } else {
          wx.showToast({ title: (res.result && res.result.message) || '操作失败', icon: 'none' });
        }
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ operating: false });
        wx.showToast({ title: '网络异常', icon: 'none' });
      });
  },

  // ============ 一键审批（仅教师/管理员，针对教师审批阶段）============

  // 点击「一键审批」按钮：先拉取待批列表用于展示摘要
  onBatchApprove() {
    if (this.data.batchApproving) return;
    wx.showLoading({ title: '获取待办...', mask: true });

    wx.cloud
      .callFunction({
        name: 'flylog',
        data: {
          action: 'list_approvals',
          pageIndex: 0,
          pageSize: 100,
          approvalStatus: LOG_STATUS.PENDING_INSTRUCTOR,
        },
      })
      .then((res) => {
        wx.hideLoading();
        if (!res.result || !res.result.success) {
          wx.showToast({ title: '获取待办失败', icon: 'none' });
          return;
        }
    const allPending = (res.result.data.list || []).filter((item) => this._canApproveLog(item, false));
        if (allPending.length === 0) {
          wx.showToast({ title: '暂无待您审批的教师待办', icon: 'none' });
          return;
        }
        this.setData({
          batchPendingList: allPending,
          showBatchApproveDialog: true,
        });
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '网络异常', icon: 'none' });
      });
  },

  closeBatchApproveDialog() {
    this.setData({ showBatchApproveDialog: false });
  },

  // 确认后执行批量审批
  doBatchApprove() {
    if (this.data.batchApproving) return;
    this.setData({ showBatchApproveDialog: false, batchApproving: true });
    wx.showLoading({ title: '批量审批中...', mask: true });

    wx.cloud
      .callFunction({
        name: 'flylog',
        data: { action: 'batch_approve_instructor' },
      })
      .then((res) => {
        wx.hideLoading();
        this.setData({ batchApproving: false });
        if (res.result && res.result.success) {
          const { successCount, failCount } = res.result.data;
          const msg = failCount > 0
            ? `完成 ${successCount} 条，${failCount} 条失败`
            : `已成功审批 ${successCount} 条日志`;
          wx.showToast({ title: msg, icon: 'success', duration: 2000 });
          this._resetLogList();
        } else {
          wx.showToast({ title: (res.result && res.result.message) || '批量审批失败', icon: 'none' });
        }
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ batchApproving: false });
        wx.showToast({ title: '网络异常，请重试', icon: 'none' });
      });
  },

  // 跳转到日志详情页（readonly=1 表示只读模式，隐藏删除/编辑按钮）
  goToLogDetail() {
    const { currentItem } = this.data;
    if (!currentItem) return;
    wx.navigateTo({ url: `/pages/detail/detail?id=${currentItem._id}&readonly=1` });
  },

  // 学员：跳转编辑页重新提交日志
  goToEdit() {
    const { currentItem } = this.data;
    if (!currentItem) return;
    wx.reLaunch({ url: `/pages/report/report?id=${currentItem._id}` });
  },
});
