// pages/profile/profile.js
const DEFAULT_AVATAR =
  'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0';

// 角色选项：显示名 -> 云端 role 值
const ROLE_OPTIONS = ['学员', '指导教师'];
const ROLE_VALUES = ['student', 'instructor'];

// 各角色对应的标签文案
const ID_LABEL_MAP = {
  student: '学号',
  instructor: '教师编号',
};

Page({
  data: {
    defaultAvatar: DEFAULT_AVATAR,
    userInfo: {
      avatarUrl: '',
      nickName: '',
    },

    // 身份注册相关
    roleOptions: ROLE_OPTIONS,
    roleIndex: 0,          // picker 当前选中下标
    role: 'student',       // 当前角色值
    idLabel: '学号',        // 编号字段标签（随角色变化）

    // 注册信息表单
    reg: {
      realName: '',   // 姓名
      studentId: '',  // 学号/编号
      phone: '',      // 联系方式
      className: '',  // 班级/单位
    },

    // 是否已完成注册（云端有记录）
    registered: false,
    // 是否处于编辑态（未注册时默认 true，已注册后默认 false）
    editing: true,
    // 保存中
    saving: false,

    editingNickname: false,
    isAdmin: false,
    openid: '',

    // 用户注册审批状态
    userApprovalStatus: null,  // null / 'pending' / 'approved' / 'rejected'
    pendingData: null,         // 待审批的信息快照
    userApprovalLog: [],       // 审批流水（取最后一条驳回原因展示）

    // 值勤统计
    dutyStatsLoading: false,
    teacherDutySeconds: 0,   // 作为指导教师的飞行总时长（秒）
    safetyDutySeconds: 0,    // 作为安全员的飞行总时长（秒）
    teacherDutyText: '0 分钟',
    safetyDutyText: '0 分钟',

    // 待审批总数（用于审批中心入口徽标）
    pendingApprovalCount: 0,
  },
  onLoad(){
    this.fetchDutyStats();
  },
  onShow() {
    const userInfo = wx.getStorageSync('userInfo') || { avatarUrl: '', nickName: '' };
    this.setData({ userInfo });
    this.fetchUserInfo();
    // 从 globalData 同步最新待审批数，并刷新 tab 徽标
    this._refreshApprovalBadge();
  },

  // 刷新审批徽标：重新向云函数请求最新数量，更新 tab 和页内计数
  _refreshApprovalBadge() {
    const app = getApp();
    wx.cloud
      .callFunction({ name: 'flylog', data: { action: 'get_pending_approval_count' } })
      .then((res) => {
        if (res.result && res.result.success) {
          const total = res.result.data.total || 0;
          app.globalData.pendingApprovalCount = total;
          app.updateApprovalTabBadge(total);
          this.setData({ pendingApprovalCount: total });
        }
      })
      .catch((err) => {
        console.warn('[profile] _refreshApprovalBadge failed:', err);
        // 降级：直接从 globalData 读取上次缓存值
        const total = app.globalData.pendingApprovalCount || 0;
        this.setData({ pendingApprovalCount: total });
      });
  },

  // 从云端拉取用户完整信息
  fetchUserInfo() {
    wx.showLoading({ title: '加载中', mask: false });
    wx.cloud
      .callFunction({ name: 'flylog', data: { action: 'who_am_i' } })
      .then((res) => {
        wx.hideLoading();
        if (res.result && res.result.success) {
          const d = res.result.data;
          const roleValue = d.role || 'student';
          const roleIdx = ROLE_VALUES.indexOf(roleValue);
          const safeIdx = roleIdx >= 0 ? roleIdx : 0;
          const approvalStatus = d.userApprovalStatus || null;
          const pendingData = d.pendingData || null;

          // 表单展示：pending/rejected 时展示 pendingData（申请中的值），否则展示正式字段
          const displayData = (approvalStatus === 'pending' || approvalStatus === 'rejected') && pendingData
            ? pendingData
            : d;

          this.setData({
            isAdmin: !!d.isAdmin,
            openid: d.openid || '',
            registered: !!d.registered,
            // 已注册且无审批中申请时只读；有待审批/被驳回时允许重新编辑
            editing: !d.registered || approvalStatus === 'rejected',
            role: roleValue,
            roleIndex: safeIdx,
            idLabel: ID_LABEL_MAP[roleValue] || '编号',
            userApprovalStatus: approvalStatus,
            pendingData,
            userApprovalLog: d.userApprovalLog || [],
            reg: {
              realName: displayData.realName || '',
              studentId: displayData.studentId || '',
              phone: displayData.phone || '',
              className: displayData.className || '',
            },
          });

          // 同步本地 userProfile 供填报页预填（只同步已生效的正式字段）
          if (d.registered && d.realName) {
            wx.setStorageSync('userProfile', {
              pilotName: d.realName || '',
              pilotId: d.studentId || '',
              className: d.className || '',
              teacher: '',
            });
          }
        }
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '加载失败，请重试', icon: 'none' });
      });
  },

  // 拉取值勤统计
  fetchDutyStats() {
    this.setData({ dutyStatsLoading: true });
    wx.cloud
      .callFunction({ name: 'flylog', data: { action: 'my_duty_stats' } })
      .then((res) => {
        this.setData({ dutyStatsLoading: false });
        if (res.result && res.result.success) {
          const d = res.result.data;
          this.setData({
            teacherDutySeconds: d.teacherDutySeconds || 0,
            safetyDutySeconds: d.safetyDutySeconds || 0,
            teacherDutyText: this._formatDuration(d.teacherDutySeconds || 0),
            safetyDutyText: this._formatDuration(d.safetyDutySeconds || 0),
          });
        }
      })
      .catch(() => this.setData({ dutyStatsLoading: false }));
  },

  // 将秒数格式化为可读时长
  _formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '0 分钟';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0 && m > 0) return `${h} 小时 ${m} 分钟`;
    if (h > 0) return `${h} 小时 ${m} 分钟`;
    if (m > 0) return `${m} 分钟 ${s} 秒`;
    return `${s} 秒`;
  },

  // 角色下拉选择
  onRolePick(e) {
    const idx = Number(e.detail.value);
    const roleValue = ROLE_VALUES[idx];
    this.setData({
      roleIndex: idx,
      role: roleValue,
      idLabel: ID_LABEL_MAP[roleValue] || '编号',
    });
  },

  // 注册表单输入
  onRegInput(e) {
    const { field } = e.currentTarget.dataset;
    const reg = { ...this.data.reg, [field]: e.detail.value };
    this.setData({ reg });
  },

  // 点击「更新信息」进入编辑态
  startEditing() {
    this.setData({ editing: true });
  },

  // 保存/更新注册信息
  saveProfile() {
    const { reg, userInfo } = this.data;
    if (!reg.realName.trim()) {
      wx.showToast({ title: '请填写姓名', icon: 'none' });
      return;
    }
    if (!reg.studentId.trim()) {
      wx.showToast({ title: `请填写${this.data.idLabel}`, icon: 'none' });
      return;
    }
    if (!reg.className.trim()) {
      wx.showToast({ title: '请填写班级/单位', icon: 'none' });
      return;
    }

    if (this.data.saving) return;
    this.setData({ saving: true });
    wx.showLoading({ title: '保存中', mask: true });

    wx.cloud
      .callFunction({
        name: 'flylog',
        data: {
          action: 'upsert_user',
          data: {
            nickName: userInfo.nickName || '',
            avatarUrl: userInfo.avatarUrl || '',
            realName: reg.realName.trim(),
            studentId: reg.studentId.trim(),
            phone: reg.phone.trim(),
            className: reg.className.trim(),
            // 注意：role 由管理员设置，普通用户首次注册时默认 student；
            // 此处前端传 requestedRole 仅用于首次注册时写入（云函数默认 student）
            // 若需支持前端自选角色写入，需云函数侧配合开放；
            // 当前云函数 upsert_user 不接受 role 参数，首次默认 student
          },
        },
      })
      .then((res) => {
        wx.hideLoading();
        this.setData({ saving: false });
        if (res.result && res.result.success) {
          // 更新本地状态：已提交待审批
          this.setData({
            registered: true,
            editing: false,
            userApprovalStatus: 'pending',
            pendingData: {
              realName: reg.realName.trim(),
              studentId: reg.studentId.trim(),
              phone: reg.phone.trim(),
              className: reg.className.trim(),
            },
          });
          wx.showModal({
            title: '已提交审批',
            content: '您的信息已提交，请等待管理员审核。审核通过后信息正式生效。',
            showCancel: false,
            confirmText: '知道了',
          });
        } else {
          wx.showToast({
            title: (res.result && res.result.message) || '保存失败',
            icon: 'none',
          });
        }
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ saving: false });
        wx.showToast({ title: '网络异常，请重试', icon: 'none' });
      });
  },

  // 复制 OpenID
  copyOpenid() {
    if (!this.data.openid) return;
    wx.setClipboardData({
      data: this.data.openid,
      success: () => wx.showToast({ title: '已复制 OpenID', icon: 'success' }),
    });
  },

  // 选择头像
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    const userInfo = { ...this.data.userInfo, avatarUrl };
    this.setData({ userInfo });
    wx.setStorageSync('userInfo', userInfo);
  },

  onAvatarTap() {},

  startEditNickname() {
    this.setData({ editingNickname: true });
    setTimeout(() => {
      this.setData({ nicknameFocus: true });
    }, 50);
  },

  onNicknameInput(e) {
    const userInfo = { ...this.data.userInfo, nickName: e.detail.value };
    this.setData({ userInfo });
  },

  onNicknameBlur(e) {
    const nickName = (e.detail.value || '').trim();
    const userInfo = { ...this.data.userInfo, nickName };
    this.setData({ userInfo, editingNickname: false });
    wx.setStorageSync('userInfo', userInfo);
  },

  clearUserInfo() {
    wx.showModal({
      title: '清除信息',
      content: '将清空当前头像与昵称，确定吗？',
      success: (r) => {
        if (r.confirm) {
          const userInfo = { avatarUrl: '', nickName: '' };
          this.setData({ userInfo, editingNickname: false });
          wx.setStorageSync('userInfo', userInfo);
        }
      },
    });
  },

  goReport() {
    wx.switchTab({ url: '/pages/report/report' });
  },

  goStats() {
    wx.switchTab({ url: '/pages/stats/stats' });
  },

  goApproval() {
    wx.navigateTo({ url: '/pages/approval/approval' });
  },
});
