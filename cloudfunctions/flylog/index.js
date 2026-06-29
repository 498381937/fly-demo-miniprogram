// 云函数入口：飞行日志相关操作
// 支持的 action：
//   - who_am_i          获取当前用户信息（含角色）
//   - upsert_user       注册/更新当前用户信息
//   - get_user          获取指定用户信息（管理员可查任意用户）
//   - list_users        查询用户列表（仅管理员）
//   - list_personnel    查询所有非管理员人员（任何登录用户可调用）
//   - set_user_role     设置用户角色（仅管理员）
//   - gen_code          生成日志编号（FLY-YYYYMMDD-NNN）
//   - create            创建日志（创建后状态为 pending_safety，待安全员审批）
//   - update            更新日志（用户只能改自己的记录，任意状态均可修改，修改后重置为待安全员审批）
//   - remove            删除日志（管理员可删任意记录；普通用户只能删自己）
//   - detail            查询日志详情（管理员/指导教师/安全员可查关联记录；普通用户只能查自己）
//   - list              查询日志列表（scope=all 需管理员，默认 mine；学员只能看 approved 的）
//   - stats             统计数据（scope=all 需管理员，默认 mine）
//   - my_duty_stats     统计当前用户作为指导教师/安全员的值勤飞行时长（仅 approved 日志）
//   - approve           审批通过（安全员：pending_safety→pending_instructor；教师：pending_instructor→approved）
//   - reject            审批驳回（安全员/教师/管理员均可驳回，状态→rejected）
//   - list_approvals    查询待审批列表（安全员看 pending_safety，教师看 pending_instructor，管理员看全部待审批）
//   - list_admins       列出所有管理员（管理员可用，兼容旧版）
//   - add_admin         添加管理员（管理员可用，兼容旧版）
//   - remove_admin      移除管理员（管理员可用，不能删自己，兼容旧版）

// ============ 审批状态说明 ============
// pending_safety    - 待安全员审批（日志提交后初始状态）
// pending_instructor - 安全员已通过，待指导教师审批
// approved          - 全部审批通过，可用于展示和查询
// rejected          - 审批被驳回，学员可修改后重新提交（任意状态均可修改）

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const COLLECTION = 'flight_logs';
const ADMIN_COLLECTION = 'admins';
const USER_COLLECTION = 'users';

// 合法角色枚举
// admin      - 管理员
// student    - 学员
// instructor - 指导教师
const VALID_ROLES = ['admin', 'student', 'instructor'];

// 审批状态枚举
const APPROVAL_STATUS = {
  PENDING_SAFETY: 'pending_safety',         // 待安全员审批
  PENDING_INSTRUCTOR: 'pending_instructor', // 待指导教师审批
  APPROVED: 'approved',                     // 已通过
  REJECTED: 'rejected',                     // 已驳回
};

const pad = (n) => (n < 10 ? '0' + n : '' + n);

// 返回北京时间（UTC+8）的格式化字符串，如 "2026-06-15 19:45:00"
function formatLocalTime() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function formatDateKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function hmsToSeconds(hms) {
  if (!hms) return 0;
  const parts = hms.split(':').map(Number);
  return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
}

// 判断错误是否为「集合不存在」
function isCollectionNotExistError(err) {
  if (!err) return false;
  const msg = (err.errMsg || err.message || '') + '';
  return (
    err.errCode === -502005 ||
    msg.includes('-502005') ||
    msg.includes('DATABASE_COLLECTION_NOT_EXIST') ||
    msg.includes('not exist') ||
    msg.includes('collection not exists')
  );
}

// 尝试创建集合；若已存在则忽略
async function ensureCollection(name) {
  try {
    if (typeof db.createCollection === 'function') {
      await db.createCollection(name);
      return;
    }
  } catch (err) {
    if (isCollectionNotExistError(err)) return;
    const msg = (err.errMsg || err.message || '') + '';
    if (msg.includes('ALREADY_EXISTS') || msg.includes('already exist')) return;
    console.warn(`[flylog] createCollection(${name}) warn:`, msg);
  }
}

// 判断 openid 是否管理员：优先查 admins 集合
async function isAdmin(openid) {
  if (!openid) return false;
  // try {
  //   // 先查新 users 集合
  //   const res = await db
  //     .collection(USER_COLLECTION)
  //     .where({ openid, role: 'admin', status: 'active' })
  //     .limit(1)
  //     .get();
  //   if (res.data.length > 0) return true;
  // } catch (err) {
  //   if (!isCollectionNotExistError(err)) {
  //     console.warn('[flylog] isAdmin users query failed:', err.message || err);
  //   }
  // }
  // 兼容旧 admins 集合
  try {
    const res = await db
      .collection(ADMIN_COLLECTION)
      .where({ openid })
      .limit(1)
      .get();
    return res.data.length > 0;
  } catch (err) {
    if (isCollectionNotExistError(err)) return false;
    console.warn('[flylog] isAdmin admins query failed:', err.message || err);
    return false;
  }
}

// 获取用户完整信息（含角色）；未注册返回 null
async function getUserInfo(openid) {
  if (!openid) return null;
  try {
    const res = await db
      .collection(USER_COLLECTION)
      .where({ openid })
      .limit(1)
      .get();
    return res.data[0] || null;
  } catch (err) {
    if (isCollectionNotExistError(err)) return null;
    throw err;
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action;

  try {
    switch (action) {
      case 'who_am_i':
        return await whoAmI(OPENID);
      case 'upsert_user':
        return await upsertUser(event, OPENID);
      case 'get_user':
        return await getUser(event, OPENID);
      case 'list_users':
        return await listUsers(event, OPENID);
      case 'list_personnel':
        return await listPersonnel(OPENID);
      case 'set_user_role':
        return await setUserRole(event, OPENID);
      case 'gen_code':
        return await genCode(event);
      case 'create':
        return await create(event, OPENID);
      case 'update':
        return await update(event, OPENID);
      case 'remove':
        return await remove(event, OPENID);
      case 'detail':
        return await detail(event, OPENID);
      case 'list':
        return await list(event, OPENID);
      case 'stats':
        return await stats(event, OPENID);
      case 'my_duty_stats':
        return await myDutyStats(OPENID);
      case 'approve':
        return await approve(event, OPENID);
      case 'batch_approve_instructor':
        return await batchApproveInstructor(event, OPENID);
      case 'reject':
        return await reject(event, OPENID);
      case 'list_approvals':
        return await listApprovals(event, OPENID);
      case 'approve_user':
        return await approveUser(event, OPENID);
      case 'reject_user':
        return await rejectUser(event, OPENID);
      case 'list_user_approvals':
        return await listUserApprovals(event, OPENID);
      case 'get_pending_approval_count':
        return await getPendingApprovalCount(OPENID);
      case 'list_admins':
        return await listAdmins(OPENID);
      case 'add_admin':
        return await addAdmin(event, OPENID);
      case 'remove_admin':
        return await removeAdmin(event, OPENID);
      default:
        return { success: false, message: `未知 action: ${action}` };
    }
  } catch (err) {
    console.error('[flylog] error:', err);
    return { success: false, message: err.message || '云函数执行失败' };
  }
};

// ============ 用户信息 ============
async function whoAmI(openid) {
  const [admin, userDoc] = await Promise.all([
    isAdmin(openid),
    getUserInfo(openid),
  ]);
  return {
    success: true,
    data: {
      openid,
      isAdmin: admin,
      role: userDoc ? userDoc.role : null,
      status: userDoc ? userDoc.status : null,
      nickName: userDoc ? userDoc.nickName : null,
      realName: userDoc ? userDoc.realName : null,
      avatarUrl: userDoc ? userDoc.avatarUrl : null,
      studentId: userDoc ? userDoc.studentId : null,
      phone: userDoc ? userDoc.phone : null,
      className: userDoc ? userDoc.className : null,
      registered: !!userDoc,
      // 用户注册审批状态
      userApprovalStatus: userDoc ? (userDoc.userApprovalStatus || null) : null,
      pendingData: userDoc ? (userDoc.pendingData || null) : null,
      userApprovalLog: userDoc ? (userDoc.userApprovalLog || []) : [],
    },
  };
}

// ============ 注册 / 更新当前用户 ============
// 提交的信息不立即生效，而是存入 pendingData 并设置 userApprovalStatus=pending，
// 由管理员在审批中心审核通过后才写入正式字段。
// 例外：nickName / avatarUrl 不需审批，直接更新。
async function upsertUser(event, openid) {
  const {
    nickName = '',
    avatarUrl = '',
    realName = '',
    studentId = '',
    phone = '',
    className = '',
  } = event.data || {};

  const now = db.serverDate();
  const nowIso = formatLocalTime();
  let existing = null;

  try {
    const res = await db
      .collection(USER_COLLECTION)
      .where({ openid })
      .limit(1)
      .get();
    existing = res.data[0] || null;
  } catch (err) {
    if (!isCollectionNotExistError(err)) throw err;
  }

  // 待审批的信息快照（仅包含需要审批的业务字段）
  const pendingData = {};
  if (realName) pendingData.realName = realName;
  if (studentId) pendingData.studentId = studentId;
  if (phone) pendingData.phone = phone;
  if (className) pendingData.className = className;

  if (existing) {
    // 已注册：将变更写入 pendingData，标记待审批；nickName/avatarUrl 直接更新
    const updateData = {
      updateTime: now,
      pendingData,
      userApprovalStatus: 'pending',
      userApprovalLog: _.push([{
        action: 'submit',
        operatorOpenid: openid,
        note: '用户提交信息更新申请',
        time: nowIso,
      }]),
    };
    if (nickName) updateData.nickName = nickName;
    if (avatarUrl) updateData.avatarUrl = avatarUrl;

    await db
      .collection(USER_COLLECTION)
      .where({ openid })
      .update({ data: updateData });

    return { success: true, data: { _id: existing._id, created: false, needsApproval: true } };
  }

  // 首次注册：写入基础记录（realName 等字段暂存 pendingData），等待管理员审批激活
  const payload = {
    openid,
    nickName,
    avatarUrl,
    // 正式字段暂为空，审批通过后从 pendingData 同步
    realName: '',
    studentId: '',
    phone: '',
    className: '',
    role: 'student',
    status: 'active',
    // 审批相关
    pendingData,
    userApprovalStatus: 'pending',
    userApprovalLog: [{
      action: 'submit',
      operatorOpenid: openid,
      note: '首次注册，等待管理员审批',
      time: nowIso,
    }],
    createTime: now,
    updateTime: now,
  };

  let res;
  try {
    res = await db.collection(USER_COLLECTION).add({ data: payload });
  } catch (err) {
    if (isCollectionNotExistError(err)) {
      await ensureCollection(USER_COLLECTION);
      res = await db.collection(USER_COLLECTION).add({ data: payload });
    } else {
      throw err;
    }
  }

  return { success: true, data: { _id: res._id, created: true, needsApproval: true } };
}

// ============ 查询指定用户信息 ============
// 普通用户只能查自己；管理员可通过 targetOpenid 查任意用户。
async function getUser(event, openid) {
  const admin = await isAdmin(openid);
  const targetOpenid = (admin && event.targetOpenid) ? event.targetOpenid : openid;

  const doc = await getUserInfo(targetOpenid);
  if (!doc) return { success: false, message: '用户不存在' };
  return { success: true, data: doc };
}

// ============ 查询用户列表（仅管理员）============
// 支持按 role / status / keyword 筛选，支持分页。
async function listUsers(event, openid) {
  const admin = await isAdmin(openid);
  if (!admin) return { success: false, message: '无权限' };

  const {
    role = '',       // 按角色筛选，空则不限
    status = '',     // 按状态筛选，空则不限
    keyword = '',    // 模糊匹配 nickName / realName / studentId
    pageSize = 20,
    pageIndex = 0,
  } = event;

  const andConds = [];
  if (role && VALID_ROLES.includes(role)) andConds.push({ role });
  if (status) andConds.push({ status });
  if (keyword) {
    const reg = db.RegExp({ regexp: keyword, options: 'i' });
    andConds.push(
      _.or([{ nickName: reg }, { realName: reg }, { studentId: reg }, { phone: reg }]),
    );
  }

  const whereClause =
    andConds.length === 0
      ? {}
      : andConds.length === 1
      ? andConds[0]
      : _.and(andConds);

  const emptyResult = {
    success: true,
    data: { list: [], total: 0, pageIndex, pageSize, hasMore: false },
  };

  let countRes;
  try {
    countRes = await db.collection(USER_COLLECTION).where(whereClause).count();
  } catch (err) {
    if (isCollectionNotExistError(err)) return emptyResult;
    throw err;
  }

  let res;
  try {
    res = await db
      .collection(USER_COLLECTION)
      .where(whereClause)
      .orderBy('createTime', 'desc')
      .skip(pageIndex * pageSize)
      .limit(pageSize)
      .get();
  } catch (err) {
    if (isCollectionNotExistError(err)) return emptyResult;
    throw err;
  }

  return {
    success: true,
    data: {
      list: res.data,
      total: countRes.total,
      pageIndex,
      pageSize,
      hasMore: (pageIndex + 1) * pageSize < countRes.total,
    },
  };
}

// ============ 查询所有人员（任何登录用户可调用，用于填报日志时选择安全员等）============
// 只返回已审批通过（userApprovalStatus=approved 或无该字段的旧数据）的 active 用户
// 字段仅含 realName / studentId / role，不暴露敏感信息。
async function listPersonnel(openid) {
  if (!openid) return { success: false, message: '未登录' };

  const emptyResult = { success: true, data: [] };

  let res;
  try {
    res = await db
      .collection(USER_COLLECTION)
      .where({
        role: _.neq('admin'),
        status: 'active',
        // 只返回已通过审批的用户（或历史无该字段的数据，兼容性处理）
        userApprovalStatus: _.in(['approved', null]),
      })
      .orderBy('realName', 'asc')
      .limit(200)
      .field({ openid: true, realName: true, studentId: true, role: true })
      .get();
  } catch (err) {
    if (isCollectionNotExistError(err)) return emptyResult;
    // 若 $in 对 null 不支持，降级为不过滤审批状态
    try {
      res = await db
        .collection(USER_COLLECTION)
        .where({ role: _.neq('admin'), status: 'active' })
        .orderBy('realName', 'asc')
        .limit(200)
        .field({ openid: true, realName: true, studentId: true, role: true, userApprovalStatus: true })
        .get();
      // 客户端过滤
      res = { data: res.data.filter((u) => !u.userApprovalStatus || u.userApprovalStatus === 'approved') };
    } catch (e2) {
      if (isCollectionNotExistError(e2)) return emptyResult;
      throw e2;
    }
  }

  return { success: true, data: res.data };
}

// ============ 设置用户角色 / 状态（仅管理员）============
// 支持同时修改 role 和 status；至少传一个。
// 管理员不能变更自己的角色（防止误操作丢失权限）。
async function setUserRole(event, openid) {
  const admin = await isAdmin(openid);
  if (!admin) return { success: false, message: '无权限' };

  const targetOpenid = (event.targetOpenid || '').trim();
  if (!targetOpenid) return { success: false, message: '缺少 targetOpenid' };
  if (targetOpenid === openid) return { success: false, message: '不能变更自己的角色' };

  const { role, status } = event;
  if (role === undefined && status === undefined) {
    return { success: false, message: '至少需要提供 role 或 status' };
  }
  if (role !== undefined && !VALID_ROLES.includes(role)) {
    return {
      success: false,
      message: `无效角色，合法值为：${VALID_ROLES.join(' / ')}`,
    };
  }
  if (status !== undefined && !['active', 'disabled'].includes(status)) {
    return { success: false, message: '无效状态，合法值为：active / disabled' };
  }

  // 检查目标用户是否存在
  const existing = await getUserInfo(targetOpenid);
  if (!existing) return { success: false, message: '目标用户不存在，请先让其注册' };

  const updateData = { updateTime: db.serverDate() };
  if (role !== undefined) updateData.role = role;
  if (status !== undefined) updateData.status = status;

  await db
    .collection(USER_COLLECTION)
    .where({ openid: targetOpenid })
    .update({ data: updateData });

  return { success: true, data: { targetOpenid, ...updateData } };
}

// ============ 生成日志编号 ============
async function genCode(event) {
  const flightDate = event.flightDate || new Date();
  const dateKey = formatDateKey(flightDate);

  const { OPENID } = cloud.getWXContext();
  let total = 0;
  try {
    const countRes = await db
      .collection(COLLECTION)
      .where({ _openid: OPENID, dateKey })
      .count();
    total = countRes.total || 0;
  } catch (err) {
    if (!isCollectionNotExistError(err)) throw err;
    total = 0;
  }

  const nextIndex = total + 1;
  const code = `FLY-${dateKey}-${String(nextIndex).padStart(3, '0')}`;
  return { success: true, data: { code, index: nextIndex, dateKey } };
}

// ============ 创建日志 ============
async function create(event, openid) {
  const data = event.data || {};
  const now = db.serverDate();

  // 字符串/picker 类型必填字段
  const requiredFields = [
    'flightDate',
    'takeoffTime',
    'landingTime',
    'pilotName',
    'pilotId',
    'className',
    'teacher',
    'safetyOfficer',
    'droneModel',
    'missionType',
    'flightMode',
    'airspaceCode',
  ];
  for (const f of requiredFields) {
    if (data[f] === undefined || data[f] === null || data[f] === '') {
      return { success: false, message: `字段 ${f} 不能为空` };
    }
  }

  // 评分字段必填（值需 >= 1）
  const ratingFields = [
    'ratingTakeoffLanding',
    'ratingDriftRange',
    'ratingDriftAltitude',
  ];
  for (const f of ratingFields) {
    if (!data[f] || Number(data[f]) < 1) {
      return { success: false, message: `字段 ${f} 需评分（1-5分）` };
    }
  }
  // 航线完整仅航线类任务必填（前4个悬停任务不需要）
  const HOVER_MISSIONS = ['对尾悬停', '对左悬停', '对右悬停', '对头悬停'];
  const needRouteIntegrity = !HOVER_MISSIONS.includes(data.missionType);
  if (needRouteIntegrity && (!data.ratingRouteIntegrity || Number(data.ratingRouteIntegrity) < 1)) {
    return { success: false, message: '字段 ratingRouteIntegrity 需评分（1-5分）' };
  }

  const dateKey = formatDateKey(data.flightDate);
  let logCode = data.logCode;
  if (!logCode) {
    const gen = await genCode({ flightDate: data.flightDate });
    logCode = gen.data.code;
  }

  const durationSeconds = hmsToSeconds(data.totalDuration);

  const payload = {
    ...data,
    _openid: openid, // 云函数写入时需手动注入 _openid
    logCode,
    dateKey,
    durationSeconds,
    approvalStatus: APPROVAL_STATUS.PENDING_SAFETY, // 初始状态：待安全员审批
    approvalLog: [],                                // 审批流水记录
    createTime: now,
    updateTime: now,
  };

  let res;
  try {
    res = await db.collection(COLLECTION).add({ data: payload });
  } catch (err) {
    if (isCollectionNotExistError(err)) {
      await ensureCollection(COLLECTION);
      res = await db.collection(COLLECTION).add({ data: payload });
    } else {
      throw err;
    }
  }

  return { success: true, data: { _id: res._id, logCode } };
}

// ============ 更新日志 ============
// 管理员可改任意记录；普通用户只能修改自己且状态为 rejected（被驳回）的记录
// 修改后状态自动重置为 pending_safety（重新进入审批流）
async function update(event, openid) {
  const { _id, data } = event;
  if (!_id) return { success: false, message: '缺少 _id' };

  const updateData = { ...data, updateTime: db.serverDate() };
  if (data && data.totalDuration) {
    updateData.durationSeconds = hmsToSeconds(data.totalDuration);
  }
  if (data && data.flightDate) {
    updateData.dateKey = formatDateKey(data.flightDate);
  }
  // 防止被恶意篡改所属用户和审批状态
  delete updateData._openid;
  delete updateData._id;
  delete updateData.approvalLog;
  delete updateData.approvalStatus;

  // 用户只能修改自己的日志（无论状态），修改后重新进入审批流
  const checkRes = await db.collection(COLLECTION)
    .where({ _id, _openid: openid })
    .limit(1)
    .get();
  if (!checkRes.data || checkRes.data.length === 0) {
    return { success: false, message: '记录不存在或无权修改' };
  }

  // 修改后重置为待安全员审批，并清空旧审批记录
  updateData.approvalStatus = APPROVAL_STATUS.PENDING_SAFETY;
  updateData.approvalLog = [];

  try {
    const res = await db.collection(COLLECTION).where({ _id, _openid: openid }).update({
      data: updateData,
    });
    if (!res.stats || res.stats.updated === 0) {
      return { success: false, message: '记录不存在或无权修改' };
    }
  } catch (err) {
    if (isCollectionNotExistError(err)) {
      return { success: false, message: '记录不存在' };
    }
    throw err;
  }

  return { success: true };
}

// ============ 删除日志 ============
async function remove(event, openid) {
  const { _id } = event;
  if (!_id) return { success: false, message: '缺少 _id' };

  const admin = await isAdmin(openid);
  const where = admin ? { _id } : { _id, _openid: openid };

  try {
    const res = await db.collection(COLLECTION).where(where).remove();
    return { success: true, data: res.stats };
  } catch (err) {
    if (isCollectionNotExistError(err)) {
      return { success: true, data: { removed: 0 } };
    }
    throw err;
  }
}

// ============ 日志详情 ============
// 权限：管理员可查任意；普通用户可查自己的；
// 安全员可查 safetyOfficer 字段匹配自己 realName 的记录；
// 指导教师可查 teacher 字段匹配自己 realName 的记录
async function detail(event, openid) {
  const { _id } = event;
  if (!_id) return { success: false, message: '缺少 _id' };

  const [admin, userDoc] = await Promise.all([isAdmin(openid), getUserInfo(openid)]);

  try {
    let res;
    if (admin) {
      res = await db.collection(COLLECTION).where({ _id }).get();
    } else if (userDoc && userDoc.role === 'instructor') {
      // 教师：自己创建的 OR teacher 字段匹配
      const ownRes = await db.collection(COLLECTION).where({ _id, _openid: openid }).limit(1).get();
      if (ownRes.data && ownRes.data.length > 0) {
        return { success: true, data: ownRes.data[0] };
      }
      if (userDoc.realName) {
        const teacherRes = await db.collection(COLLECTION)
          .where({ _id, teacher: userDoc.realName })
          .limit(1)
          .get();
        return { success: true, data: teacherRes.data[0] || null };
      }
      return { success: true, data: null };
    } else {
      res = await db.collection(COLLECTION).where({ _id, _openid: openid }).get();
    }
    return { success: true, data: (res.data && res.data[0]) || null };
  } catch (err) {
    if (isCollectionNotExistError(err)) {
      return { success: true, data: null };
    }
    throw err;
  }
}

// ============ 日志列表 ============
// scope: 'mine'（默认）| 'all'（仅管理员可用）
// ownerOpenid: 管理员可指定查看某个用户的日志
// 学员只能查看 approved 状态的日志；教师可查 approved + pending_instructor；管理员无限制
async function list(event, openid) {
  const {
    keyword = '',
    startDate = '',
    endDate = '',
    pageSize = 20,
    pageIndex = 0,
    scope = 'mine',
    ownerOpenid = '',
    approvalStatus: filterStatus = '', // 按审批状态筛选（可选）
  } = event;

  const [admin, userDoc] = await Promise.all([isAdmin(openid), getUserInfo(openid)]);
  const userRole = userDoc ? userDoc.role : 'student';
  const isInstructor = !admin && userRole === 'instructor';
  const canViewAll = admin || isInstructor;

  // 决定 openid 过滤条件
  const andConds = [];
  if (scope === 'all' && canViewAll) {
    // 管理员/教师查所有：不加 _openid 过滤
    if (ownerOpenid) {
      andConds.push({ _openid: ownerOpenid });
    }
  } else {
    // 学员 / 未开放特权：只看自己
    andConds.push({ _openid: openid });
  }

  // 审批状态过滤：学员只能看 approved；教师可看自己负责的所有状态；管理员无限制
  if (filterStatus) {
    andConds.push({ approvalStatus: filterStatus });
  } else if (!admin && userRole === 'student') {
    // 学员：只展示已审批通过的
    andConds.push({ approvalStatus: APPROVAL_STATUS.APPROVED });
  }
  // 指导教师：scope=mine 时看自己创建的所有状态（无额外限制）

  if (keyword) {
    const reg = db.RegExp({ regexp: keyword, options: 'i' });
    andConds.push(
      _.or([
        { logCode: reg },
        { pilotName: reg },
        { droneModel: reg },
        { missionType: reg },
        { className: reg },
      ]),
    );
  }

  if (startDate && endDate) {
    andConds.push({ flightDate: _.gte(startDate).and(_.lte(endDate)) });
  } else if (startDate) {
    andConds.push({ flightDate: _.gte(startDate) });
  } else if (endDate) {
    andConds.push({ flightDate: _.lte(endDate) });
  }

  const whereClause =
    andConds.length === 0
      ? {} // scope=all 且无其它条件
      : andConds.length === 1
      ? andConds[0]
      : _.and(andConds);

  const emptyResult = {
    success: true,
    data: {
      list: [],
      total: 0,
      pageIndex,
      pageSize,
      hasMore: false,
      isAdmin: admin,
      scope,
    },
  };

  let countRes;
  try {
    countRes = await db.collection(COLLECTION).where(whereClause).count();
  } catch (err) {
    if (isCollectionNotExistError(err)) return emptyResult;
    throw err;
  }

  // 管理员查 all 时，展示更多字段（包括 _openid，用于区分所属用户）
  const fieldSpec = {
    logCode: true,
    flightDate: true,
    takeoffTime: true,
    landingTime: true,
    totalDuration: true,
    pilotName: true,
    className: true,
    droneModel: true,
    missionType: true,
    preCheckResult: true,
    approvalStatus: true,
    createTime: true,
  };
  if (admin) fieldSpec._openid = true;
  // 教师查全部时也展示 _openid
  if (isInstructor && scope === 'all') fieldSpec._openid = true;

  let res;
  try {
    res = await db
      .collection(COLLECTION)
      .where(whereClause)
      .orderBy('flightDate', 'desc')
      .orderBy('createTime', 'desc')
      .skip(pageIndex * pageSize)
      .limit(pageSize)
      .field(fieldSpec)
      .get();
  } catch (err) {
    if (isCollectionNotExistError(err)) return emptyResult;
    throw err;
  }

  return {
    success: true,
    data: {
      list: res.data,
      total: countRes.total,
      pageIndex,
      pageSize,
      hasMore: (pageIndex + 1) * pageSize < countRes.total,
      isAdmin: admin,
      isInstructor,
      canViewAll,
      scope: scope === 'all' && canViewAll ? 'all' : 'mine',
    },
  };
}

// ============ 数据统计 ============
async function stats(event, openid) {
  const { scope = 'mine', ownerOpenid = '' } = event || {};
  const [admin, userDoc] = await Promise.all([isAdmin(openid), getUserInfo(openid)]);
  const isInstructor = !admin && userDoc && userDoc.role === 'instructor';
  const canViewAll = admin || isInstructor;

  // 根据身份决定匹配条件
  let matchCond = { _openid: openid };
  if (scope === 'all' && canViewAll) {
    matchCond = ownerOpenid ? { _openid: ownerOpenid } : {};
  }
  // 仅统计已通过审批的日志
  matchCond = { ...matchCond, approvalStatus: APPROVAL_STATUS.APPROVED };

  // 近 5 天日期列表
  const today = new Date();
  const dates = [];
  for (let i = 4; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 24 * 3600 * 1000);
    dates.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }

  const emptyResult = {
    success: true,
    data: {
      totalFlights: 0,
      totalDurationSeconds: 0,
      modelDistribution: [],
      missionDistribution: [],
      daily: dates.map((d) => ({ date: d, count: 0, duration: 0 })),
      isAdmin: admin,
      isInstructor,
      canViewAll,
      scope: scope === 'all' && canViewAll ? 'all' : 'mine',
    },
  };

  let totalRes;
  try {
    totalRes = await db.collection(COLLECTION).where(matchCond).count();
  } catch (err) {
    if (isCollectionNotExistError(err)) return emptyResult;
    throw err;
  }

  if (!totalRes.total) {
    return emptyResult;
  }

  const $ = db.command.aggregate;

  const safeAggregate = async (runner) => {
    try {
      return await runner();
    } catch (err) {
      if (isCollectionNotExistError(err)) return { list: [] };
      throw err;
    }
  };

  const durationAgg = await safeAggregate(() =>
    db
      .collection(COLLECTION)
      .aggregate()
      .match(matchCond)
      .group({ _id: null, total: $.sum('$durationSeconds') })
      .end(),
  );

  const modelAgg = await safeAggregate(() =>
    db
      .collection(COLLECTION)
      .aggregate()
      .match(matchCond)
      .group({
        _id: '$droneModel',
        count: $.sum(1),
        duration: $.sum('$durationSeconds'),
      })
      .end(),
  );

  const missionAgg = await safeAggregate(() =>
    db
      .collection(COLLECTION)
      .aggregate()
      .match(matchCond)
      .group({
        _id: '$missionType',
        count: $.sum(1),
        duration: $.sum('$durationSeconds'),
        avgTakeoffLanding: $.avg('$ratingTakeoffLanding'),
        avgDriftRange: $.avg('$ratingDriftRange'),
        avgDriftAltitude: $.avg('$ratingDriftAltitude'),
        avgRouteIntegrity: $.avg('$ratingRouteIntegrity'),
      })
      .end(),
  );

  const dailyAgg = await safeAggregate(() =>
    db
      .collection(COLLECTION)
      .aggregate()
      .match({ ...matchCond, flightDate: db.command.in(dates) })
      .group({
        _id: '$flightDate',
        count: $.sum(1),
        duration: $.sum('$durationSeconds'),
      })
      .end(),
  );

  const dailyMap = {};
  (dailyAgg.list || []).forEach((d) => {
    dailyMap[d._id] = d;
  });
  const daily = dates.map((d) => ({
    date: d,
    count: dailyMap[d] ? dailyMap[d].count : 0,
    duration: dailyMap[d] ? dailyMap[d].duration : 0,
  }));

  return {
    success: true,
    data: {
      totalFlights: totalRes.total,
      totalDurationSeconds:
        durationAgg.list && durationAgg.list[0]
          ? durationAgg.list[0].total
          : 0,
      modelDistribution: modelAgg.list || [],
      missionDistribution: missionAgg.list || [],
      daily,
      isAdmin: admin,
      isInstructor,
      canViewAll,
      scope: scope === 'all' && canViewAll ? 'all' : 'mine',
    },
  };
}

// ============ 审批操作 ============

// 审批通过
// 安全员（realName 与日志 safetyOfficer 字段匹配，角色不限）：pending_safety → pending_instructor
// 指导教师（realName 与日志 teacher 字段匹配）：pending_instructor → approved
// 管理员与普通用户遵循相同规则，无法跳过审批阶段
async function approve(event, openid) {
  const { _id, comment = '' } = event;
  if (!_id) return { success: false, message: '缺少 _id' };

  const [, userDoc] = await Promise.all([isAdmin(openid), getUserInfo(openid)]);
  if (!userDoc) return { success: false, message: '未注册用户，无权操作' };

  let logDoc;
  try {
    const res = await db.collection(COLLECTION).where({ _id }).get();
    logDoc = res.data && res.data[0];
  } catch (err) {
    if (isCollectionNotExistError(err)) return { success: false, message: '日志不存在' };
    throw err;
  }
  if (!logDoc) return { success: false, message: '日志不存在' };

  const logEntry = {
    action: 'approve',
    operatorOpenid: openid,
    operatorName: userDoc.realName || userDoc.nickName || openid,
    operatorRole: userDoc.role,
    comment,
    time: formatLocalTime(),
  };

  let nextStatus;

  if (logDoc.approvalStatus === APPROVAL_STATUS.PENDING_SAFETY) {
    // 安全员校验：优先用 openid 字段，兼容旧数据用 realName
    const matchByOpenid = logDoc.safetyOfficerOpenid && logDoc.safetyOfficerOpenid === openid;
    const matchByName = !logDoc.safetyOfficerOpenid && userDoc.realName && logDoc.safetyOfficer === userDoc.realName;
    if (!matchByOpenid && !matchByName) {
      return { success: false, message: '当前状态不允许操作，或您不是该日志的安全员' };
    }
    nextStatus = APPROVAL_STATUS.PENDING_INSTRUCTOR;
    logEntry.note = '安全员审批通过';
  } else if (logDoc.approvalStatus === APPROVAL_STATUS.PENDING_INSTRUCTOR) {
    // 教师校验：优先用 openid 字段，兼容旧数据用 realName
    const matchByOpenid = logDoc.teacherOpenid && logDoc.teacherOpenid === openid;
    const matchByName = !logDoc.teacherOpenid && userDoc.realName && logDoc.teacher === userDoc.realName;
    if (!matchByOpenid && !matchByName) {
      return { success: false, message: '当前状态不允许操作，或您不是该日志的指导教师' };
    }
    nextStatus = APPROVAL_STATUS.APPROVED;
    logEntry.note = '指导教师审批通过';
  } else {
    return { success: false, message: '当前状态不允许操作，或您不是该日志的审批人' };
  }

  await db.collection(COLLECTION).where({ _id }).update({
    data: {
      approvalStatus: nextStatus,
      approvalLog: _.push([logEntry]),
      updateTime: db.serverDate(),
    },
  });

  return { success: true, data: { approvalStatus: nextStatus } };
}

// 教师一键批量审批：将当前用户作为指导教师的全部 pending_instructor 日志批量通过
// 仅限教师角色，管理员无此权限
async function batchApproveInstructor(event, openid) {
  const [, userDoc] = await Promise.all([isAdmin(openid), getUserInfo(openid)]);
  if (!userDoc) return { success: false, message: '未注册用户，无权操作' };

  // 仅教师可用，管理员不得使用
  if (userDoc.role !== 'instructor') {
    return { success: false, message: '仅指导教师可使用一键审批' };
  }

  // 查询该教师待审批的全部日志（优先 openid 匹配，兼容旧数据 realName 匹配）
  let logs = [];
  try {
    const orConds = [
      { approvalStatus: APPROVAL_STATUS.PENDING_INSTRUCTOR, teacherOpenid: openid },
    ];
    if (userDoc.realName) {
      orConds.push(
        _.and([
          { approvalStatus: APPROVAL_STATUS.PENDING_INSTRUCTOR },
          { teacher: userDoc.realName },
        ]),
      );
    }
    const query = orConds.length === 1 ? orConds[0] : _.or(orConds);
    // 云数据库单次最多返回 100 条，教师待批量不会超此限制
    const res = await db.collection(COLLECTION).where(query).limit(100).get();
    logs = res.data || [];
  } catch (err) {
    if (isCollectionNotExistError(err)) return { success: true, data: { successCount: 0, failCount: 0 } };
    throw err;
  }

  if (logs.length === 0) {
    return { success: true, data: { successCount: 0, failCount: 0 } };
  }

  const now = formatLocalTime();
  const operatorName = userDoc.realName || userDoc.nickName || openid;
  const logEntry = {
    action: 'approve',
    operatorOpenid: openid,
    operatorName,
    operatorRole: userDoc.role,
    comment: event.comment || '',
    note: '指导教师一键审批通过',
    time: now,
  };

  // 并发批量更新
  let successCount = 0;
  let failCount = 0;
  await Promise.all(
    logs.map(async (doc) => {
      try {
        await db.collection(COLLECTION).where({ _id: doc._id }).update({
          data: {
            approvalStatus: APPROVAL_STATUS.APPROVED,
            approvalLog: _.push([logEntry]),
            updateTime: db.serverDate(),
          },
        });
        successCount += 1;
      } catch (e) {
        console.error('[batchApproveInstructor] fail for', doc._id, e);
        failCount += 1;
      }
    }),
  );

  return { success: true, data: { successCount, failCount, total: logs.length } };
}

// 审批驳回
// 安全员（realName 与日志 safetyOfficer 匹配，角色不限）可驳回 pending_safety
// 指导教师（realName 与日志 teacher 匹配）可驳回 pending_instructor
// 管理员与普通用户遵循相同规则，无法绕过身份校验
async function reject(event, openid) {
  const { _id, comment = '' } = event;
  if (!_id) return { success: false, message: '缺少 _id' };
  if (!comment.trim()) return { success: false, message: '驳回必须填写驳回原因' };

  const [, userDoc] = await Promise.all([isAdmin(openid), getUserInfo(openid)]);
  if (!userDoc) return { success: false, message: '未注册用户，无权操作' };

  let logDoc;
  try {
    const res = await db.collection(COLLECTION).where({ _id }).get();
    logDoc = res.data && res.data[0];
  } catch (err) {
    if (isCollectionNotExistError(err)) return { success: false, message: '日志不存在' };
    throw err;
  }
  if (!logDoc) return { success: false, message: '日志不存在' };

  // 安全员：优先 openid 匹配，兼容旧数据用 realName
  const isSafetyOfficer =
    logDoc.approvalStatus === APPROVAL_STATUS.PENDING_SAFETY
    && (
      (logDoc.safetyOfficerOpenid && logDoc.safetyOfficerOpenid === openid)
      || (!logDoc.safetyOfficerOpenid && userDoc.realName && logDoc.safetyOfficer === userDoc.realName)
    );
  // 教师：优先 openid 匹配，兼容旧数据用 realName
  const isTeacher =
    logDoc.approvalStatus === APPROVAL_STATUS.PENDING_INSTRUCTOR
    && (
      (logDoc.teacherOpenid && logDoc.teacherOpenid === openid)
      || (!logDoc.teacherOpenid && userDoc.realName && logDoc.teacher === userDoc.realName)
    );

  if (!isSafetyOfficer && !isTeacher) {
    return { success: false, message: '当前状态不允许操作，或您不是该日志的审批人' };
  }

  const logEntry = {
    action: 'reject',
    operatorOpenid: openid,
    operatorName: userDoc.realName || userDoc.nickName || openid,
    operatorRole: userDoc.role,
    comment,
    time: formatLocalTime(),
  };

  await db.collection(COLLECTION).where({ _id }).update({
    data: {
      approvalStatus: APPROVAL_STATUS.REJECTED,
      approvalLog: _.push([logEntry]),
      updateTime: db.serverDate(),
    },
  });

  return { success: true, data: { approvalStatus: APPROVAL_STATUS.REJECTED } };
}

// 查询待审批列表
// 所有用户（含管理员）均按身份匹配：safetyOfficer 字段匹配安全员，teacher 字段匹配教师
// 不再为管理员提供全库查询入口
async function listApprovals(event, openid) {
  const { pageSize = 20, pageIndex = 0, approvalStatus: filterStatus = '' } = event || {};

  const [, userDoc] = await Promise.all([isAdmin(openid), getUserInfo(openid)]);
  if (!userDoc) return { success: false, message: '未注册用户，无权操作' };

  const andConds = [];

  // 所有用户（含管理员）统一按 openid / realName 匹配
  if (!userDoc.realName && !openid) return { success: false, message: '请先完善个人信息（姓名）' };

  // 安全员匹配条件：新数据用 safetyOfficerOpenid，旧数据用 safetyOfficer(realName)
  const safetyMatchNew = { approvalStatus: APPROVAL_STATUS.PENDING_SAFETY, safetyOfficerOpenid: openid };
  const safetyMatchOld = userDoc.realName
    ? _.and([{ approvalStatus: APPROVAL_STATUS.PENDING_SAFETY }, { safetyOfficer: userDoc.realName }])
    : null;

  // 教师匹配条件
  const teacherMatchNew = { approvalStatus: APPROVAL_STATUS.PENDING_INSTRUCTOR, teacherOpenid: openid };
  const teacherMatchOld = userDoc.realName
    ? _.and([{ approvalStatus: APPROVAL_STATUS.PENDING_INSTRUCTOR }, { teacher: userDoc.realName }])
    : null;

  if (filterStatus === APPROVAL_STATUS.PENDING_SAFETY) {
    const orConds = [safetyMatchNew];
    if (safetyMatchOld) orConds.push(safetyMatchOld);
    andConds.push(orConds.length === 1 ? orConds[0] : _.or(orConds));
  } else if (filterStatus === APPROVAL_STATUS.PENDING_INSTRUCTOR) {
    const orConds = [teacherMatchNew];
    if (teacherMatchOld) orConds.push(teacherMatchOld);
    andConds.push(orConds.length === 1 ? orConds[0] : _.or(orConds));
  } else if (filterStatus === APPROVAL_STATUS.REJECTED) {
    // 被驳回的：自己提交 OR 自己是安全员/教师
    const rejectedConds = [
      { _openid: openid },
      { safetyOfficerOpenid: openid },
      { teacherOpenid: openid },
    ];
    if (userDoc.realName) {
      rejectedConds.push({ safetyOfficer: userDoc.realName });
      rejectedConds.push({ teacher: userDoc.realName });
    }
    andConds.push(
      _.and([
        { approvalStatus: APPROVAL_STATUS.REJECTED },
        _.or(rejectedConds),
      ]),
    );
  } else {
    // 默认：和自己相关的全部待审批（作为安全员 + 作为教师 + 自己提交的非通过）
    const orConds = [
      safetyMatchNew,
      teacherMatchNew,
      _.and([{ _openid: openid }, { approvalStatus: _.neq(APPROVAL_STATUS.APPROVED) }]),
    ];
    if (safetyMatchOld) orConds.push(safetyMatchOld);
    if (teacherMatchOld) orConds.push(teacherMatchOld);
    andConds.push(_.or(orConds));
  }

  const whereClause = andConds.length === 1 ? andConds[0] : _.and(andConds);

  const emptyResult = {
    success: true,
    data: { list: [], total: 0, pageIndex, pageSize, hasMore: false, userRole: userDoc.role },
  };

  let countRes;
  try {
    countRes = await db.collection(COLLECTION).where(whereClause).count();
  } catch (err) {
    if (isCollectionNotExistError(err)) return emptyResult;
    throw err;
  }

  let res;
  try {
    res = await db
      .collection(COLLECTION)
      .where(whereClause)
      .orderBy('createTime', 'desc')
      .skip(pageIndex * pageSize)
      .limit(pageSize)
      .field({
        logCode: true,
        flightDate: true,
        pilotName: true,
        className: true,
        droneModel: true,
        missionType: true,
        teacher: true,
        safetyOfficer: true,
        approvalStatus: true,
        approvalLog: true,
        createTime: true,
        _openid: true,
      })
      .get();
  } catch (err) {
    if (isCollectionNotExistError(err)) return emptyResult;
    throw err;
  }

  return {
    success: true,
    data: {
      list: res.data,
      total: countRes.total,
      pageIndex,
      pageSize,
      hasMore: (pageIndex + 1) * pageSize < countRes.total,
      userRole: userDoc.role,
    },
  };
}

// ============ 用户注册审批 ============

// 管理员审批通过用户注册/更新申请
// 通过后将 pendingData 合并到正式字段，清空 pendingData，状态→approved
async function approveUser(event, openid) {
  const { targetOpenid, comment = '' } = event;
  if (!targetOpenid) return { success: false, message: '缺少 targetOpenid' };

  const admin = await isAdmin(openid);
  if (!admin) return { success: false, message: '无权限，仅管理员可审批' };

  const adminDoc = await getUserInfo(openid);
  const adminName = adminDoc ? (adminDoc.realName || adminDoc.nickName || openid) : openid;

  // 获取目标用户
  let targetDoc;
  try {
    const res = await db.collection(USER_COLLECTION).where({ openid: targetOpenid }).limit(1).get();
    targetDoc = res.data && res.data[0];
  } catch (err) {
    if (isCollectionNotExistError(err)) return { success: false, message: '用户不存在' };
    throw err;
  }
  if (!targetDoc) return { success: false, message: '用户不存在' };
  if (targetDoc.userApprovalStatus !== 'pending') {
    return { success: false, message: '该用户当前没有待审批的申请' };
  }

  const pending = targetDoc.pendingData || {};
  const logEntry = {
    action: 'approve',
    operatorOpenid: openid,
    operatorName: adminName,
    comment,
    note: '管理员审批通过，信息已生效',
    time: formatLocalTime(),
  };

  // 将 pendingData 合并到正式字段
  const updateData = {
    userApprovalStatus: 'approved',
    pendingData: null,
    userApprovalLog: _.push([logEntry]),
    updateTime: db.serverDate(),
  };
  if (pending.realName !== undefined) updateData.realName = pending.realName;
  if (pending.studentId !== undefined) updateData.studentId = pending.studentId;
  if (pending.phone !== undefined) updateData.phone = pending.phone;
  if (pending.className !== undefined) updateData.className = pending.className;

  await db.collection(USER_COLLECTION).where({ openid: targetOpenid }).update({ data: updateData });

  return { success: true, data: { targetOpenid, userApprovalStatus: 'approved' } };
}

// 管理员驳回用户注册/更新申请
async function rejectUser(event, openid) {
  const { targetOpenid, comment = '' } = event;
  if (!targetOpenid) return { success: false, message: '缺少 targetOpenid' };
  if (!comment.trim()) return { success: false, message: '驳回必须填写驳回原因' };

  const admin = await isAdmin(openid);
  if (!admin) return { success: false, message: '无权限，仅管理员可驳回' };

  const adminDoc = await getUserInfo(openid);
  const adminName = adminDoc ? (adminDoc.realName || adminDoc.nickName || openid) : openid;

  let targetDoc;
  try {
    const res = await db.collection(USER_COLLECTION).where({ openid: targetOpenid }).limit(1).get();
    targetDoc = res.data && res.data[0];
  } catch (err) {
    if (isCollectionNotExistError(err)) return { success: false, message: '用户不存在' };
    throw err;
  }
  if (!targetDoc) return { success: false, message: '用户不存在' };
  if (targetDoc.userApprovalStatus !== 'pending') {
    return { success: false, message: '该用户当前没有待审批的申请' };
  }

  const logEntry = {
    action: 'reject',
    operatorOpenid: openid,
    operatorName: adminName,
    comment,
    note: '管理员驳回，请修改后重新提交',
    time: formatLocalTime(),
  };

  await db.collection(USER_COLLECTION).where({ openid: targetOpenid }).update({
    data: {
      userApprovalStatus: 'rejected',
      userApprovalLog: _.push([logEntry]),
      updateTime: db.serverDate(),
    },
  });

  return { success: true, data: { targetOpenid, userApprovalStatus: 'rejected' } };
}

// 查询待审批的用户注册列表（仅管理员）
async function listUserApprovals(event, openid) {
  const { pageSize = 20, pageIndex = 0, approvalStatus: filterStatus = 'pending' } = event || {};

  const admin = await isAdmin(openid);
  if (!admin) return { success: false, message: '无权限，仅管理员可查看' };

  const whereClause = filterStatus
    ? { userApprovalStatus: filterStatus }
    : { userApprovalStatus: _.in(['pending', 'rejected']) };

  const emptyResult = {
    success: true,
    data: { list: [], total: 0, pageIndex, pageSize, hasMore: false },
  };

  let countRes;
  try {
    countRes = await db.collection(USER_COLLECTION).where(whereClause).count();
  } catch (err) {
    if (isCollectionNotExistError(err)) return emptyResult;
    throw err;
  }

  let res;
  try {
    res = await db
      .collection(USER_COLLECTION)
      .where(whereClause)
      .orderBy('updateTime', 'desc')
      .skip(pageIndex * pageSize)
      .limit(pageSize)
      .field({
        openid: true,
        nickName: true,
        avatarUrl: true,
        realName: true,
        studentId: true,
        phone: true,
        className: true,
        role: true,
        status: true,
        pendingData: true,
        userApprovalStatus: true,
        userApprovalLog: true,
        createTime: true,
        updateTime: true,
      })
      .get();
  } catch (err) {
    if (isCollectionNotExistError(err)) return emptyResult;
    throw err;
  }

  return {
    success: true,
    data: {
      list: res.data,
      total: countRes.total,
      pageIndex,
      pageSize,
      hasMore: (pageIndex + 1) * pageSize < countRes.total,
    },
  };
}

// ============ 管理员管理 ============
async function listAdmins(openid) {
  const admin = await isAdmin(openid);
  if (!admin) return { success: false, message: '无权限' };

  try {
    const res = await db
      .collection(ADMIN_COLLECTION)
      .orderBy('createTime', 'asc')
      .limit(100)
      .get();
    return { success: true, data: res.data };
  } catch (err) {
    if (isCollectionNotExistError(err)) return { success: true, data: [] };
    throw err;
  }
}

async function addAdmin(event, openid) {
  const admin = await isAdmin(openid);
  if (!admin) return { success: false, message: '无权限' };

  const target = (event.openid || '').trim();
  const name = (event.name || '').trim();
  if (!target) return { success: false, message: '缺少 openid' };

  // 幂等：已存在则直接返回成功
  try {
    const existing = await db
      .collection(ADMIN_COLLECTION)
      .where({ openid: target })
      .limit(1)
      .get();
    if (existing.data.length > 0) {
      return { success: true, data: { _id: existing.data[0]._id, existed: true } };
    }
  } catch (err) {
    if (!isCollectionNotExistError(err)) throw err;
    // 集合不存在则继续创建
  }

  const payload = {
    openid: target,
    name,
    createTime: db.serverDate(),
    createdBy: openid,
  };

  let res;
  try {
    res = await db.collection(ADMIN_COLLECTION).add({ data: payload });
  } catch (err) {
    if (isCollectionNotExistError(err)) {
      await ensureCollection(ADMIN_COLLECTION);
      res = await db.collection(ADMIN_COLLECTION).add({ data: payload });
    } else {
      throw err;
    }
  }
  return { success: true, data: { _id: res._id } };
}

async function removeAdmin(event, openid) {
  const admin = await isAdmin(openid);
  if (!admin) return { success: false, message: '无权限' };

  const target = (event.openid || '').trim();
  if (!target) return { success: false, message: '缺少 openid' };
  if (target === openid) {
    return { success: false, message: '不能移除自己的管理员身份' };
  }

  try {
    const res = await db
      .collection(ADMIN_COLLECTION)
      .where({ openid: target })
      .remove();
    return { success: true, data: res.stats };
  } catch (err) {
    if (isCollectionNotExistError(err)) {
      return { success: true, data: { removed: 0 } };
    }
    throw err;
  }
}

// ============ 值勤统计 ============
// 查询当前用户作为指导教师 / 安全员的已通过日志飞行时长汇总
async function myDutyStats(openid) {
  const $ = db.command.aggregate;
  const approvedCond = { approvalStatus: APPROVAL_STATUS.APPROVED };

  const safeSum = async (matchCond) => {
    try {
      const res = await db
        .collection(COLLECTION)
        .aggregate()
        .match(matchCond)
        .group({ _id: null, total: $.sum('$durationSeconds') })
        .end();
      return (res.list && res.list.length > 0) ? (res.list[0].total || 0) : 0;
    } catch (err) {
      if (isCollectionNotExistError(err)) return 0;
      throw err;
    }
  };

  // 指导教师时长：teacherOpenid 匹配
  const teacherSeconds = await safeSum({
    ...approvedCond,
    teacherOpenid: openid,
  });

  // 安全员时长：safetyOfficerOpenid 匹配
  const safetySeconds = await safeSum({
    ...approvedCond,
    safetyOfficerOpenid: openid,
  });

  return {
    success: true,
    data: {
      teacherDutySeconds: teacherSeconds,
      safetyDutySeconds: safetySeconds,
    },
  };
}

// 查询当前用户相关的待审批总数（日志审批 + 用户注册审批）
// 非管理员：仅统计与自己相关的待审批日志数
// 管理员：统计所有待审批日志数 + 所有待审批用户注册数
async function getPendingApprovalCount(openid) {
  const [admin, userDoc] = await Promise.all([isAdmin(openid), getUserInfo(openid)]);

  let logCount = 0;
  let userApprovalCount = 0;

  // ---- 统计日志待审批数 ----
  try {
    let logWhere;
    if (admin) {
      logWhere = { approvalStatus: _.neq(APPROVAL_STATUS.APPROVED) };
    } else {
      if (!userDoc) {
        return { success: true, data: { total: 0, logCount: 0, userApprovalCount: 0 } };
      }
      // 与当前用户相关：作为安全员 or 作为教师（兼容新旧数据）
      const orConds = [
        { approvalStatus: APPROVAL_STATUS.PENDING_SAFETY, safetyOfficerOpenid: openid },
        { approvalStatus: APPROVAL_STATUS.PENDING_INSTRUCTOR, teacherOpenid: openid },
      ];
      logWhere = _.or(orConds);
    }
    const res = await db.collection(COLLECTION).where(logWhere).count();
    logCount = res.total || 0;
  } catch (err) {
    if (!isCollectionNotExistError(err)) {
      console.warn('[flylog] getPendingApprovalCount logCount error:', err.message || err);
    }
  }

  // ---- 统计用户注册待审批数（仅管理员） ----
  if (admin) {
    try {
      const res = await db
        .collection(USER_COLLECTION)
        .where({ userApprovalStatus: 'pending' })
        .count();
      userApprovalCount = res.total || 0;
    } catch (err) {
      if (!isCollectionNotExistError(err)) {
        console.warn('[flylog] getPendingApprovalCount userApprovalCount error:', err.message || err);
      }
    }
  }

  const total = logCount + userApprovalCount;
  return {
    success: true,
    data: { total, logCount, userApprovalCount, isAdmin: admin },
  };
}
