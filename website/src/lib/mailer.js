'use strict';
const nodemailer = require('nodemailer');

/**
 * Optional SMTP notification. The site works fully without it — inquiries are
 * always stored and visible in the backend; email is only a nudge to the sales
 * team. Sending never blocks or fails a visitor's request.
 */
const enabled = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);

let transport = null;
if (enabled) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 465,
    secure: !/^(0|false|no)$/i.test(String(process.env.SMTP_SECURE ?? '1')),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' },
  });
}

function status() {
  return {
    enabled,
    host: process.env.SMTP_HOST || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    // Where a reply should land when the From address cannot take one. A
    // relay like Aliyun DirectMail sends as noreply@<verified domain>, so
    // without this a salesperson hitting Reply writes to nobody.
    replyTo: process.env.SMTP_REPLY_TO || '',
    to: (process.env.INQUIRY_NOTIFY_TO || '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

/**
 * Opens a connection and authenticates, without sending anything. Returns
 * `{ ok }` or `{ ok: false, code, message, response }` so the command-line
 * check can explain which step failed.
 */
async function verify() {
  if (!enabled) return { ok: false, code: 'DISABLED', message: 'SMTP_HOST / SMTP_USER 未配置' };
  try {
    await transport.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, code: err.code || '', message: err.message, response: err.response || '' };
  }
}

/** Sends one plain test message; used by `npm run mail-test`. */
async function sendTest(to) {
  if (!enabled) return { ok: false, code: 'DISABLED', message: 'SMTP_HOST / SMTP_USER 未配置' };
  try {
    const info = await transport.sendMail({
      from: status().from,
      replyTo: status().replyTo || undefined,
      to: to,
      subject: '[Durlevel] SMTP 测试邮件',
      text: '这是一封测试邮件。收到它说明询盘邮件通知已经可以正常发送。\n\n' +
            '发信服务器: ' + (process.env.SMTP_HOST || '') + ':' + (Number(process.env.SMTP_PORT) || 465) + '\n' +
            '发信账号: ' + (process.env.SMTP_USER || '') + '\n' +
            '时间: ' + new Date().toISOString() + '\n',
    });
    return { ok: true, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
  } catch (err) {
    return { ok: false, code: err.code || '', message: err.message, response: err.response || '' };
  }
}

/** Fire-and-forget: resolves to true when sent, false when skipped or failed. */
async function notifyInquiry(inquiry, items, recipients) {
  if (!enabled) return false;
  const to = (recipients && recipients.length ? recipients : status().to).join(',');
  if (!to) return false;

  const lines = items.map(
    (it, i) => `${i + 1}. ${it.name_en}  数量: ${it.quantity || '未填'}  备注: ${it.note || '-'}`
  );
  const body = [
    `账号: ${inquiry.username}`,
    `公司: ${inquiry.company || '-'}`,
    `联系人: ${inquiry.contact_name || '-'}`,
    `邮箱: ${inquiry.email || '-'}`,
    `电话: ${inquiry.phone || '-'}`,
    `国家/地区: ${inquiry.country || '-'}`,
    '',
    '产品:',
    ...lines,
    '',
    `留言: ${inquiry.message || '-'}`,
  ].join('\n');

  try {
    await transport.sendMail({
      from: status().from,
      to,
      // This notification goes to the sales team, so Reply should reach the
      // buyer who sent the inquiry — not the mailbox it was sent from. That
      // is what makes the mail answerable straight from the inbox.
      replyTo: inquiry.email || status().replyTo || undefined,
      subject: `[询盘] ${inquiry.company || inquiry.username} - ${items.length} 个产品`,
      text: body,
    });
    return true;
  } catch (err) {
    console.error('[mailer] inquiry notification failed:', err.message);
    return false;
  }
}

module.exports = { enabled, status, verify, sendTest, notifyInquiry };
