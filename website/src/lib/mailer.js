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
    to: (process.env.INQUIRY_NOTIFY_TO || '').split(',').map((s) => s.trim()).filter(Boolean),
  };
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
      subject: `[询盘] ${inquiry.company || inquiry.username} - ${items.length} 个产品`,
      text: body,
    });
    return true;
  } catch (err) {
    console.error('[mailer] inquiry notification failed:', err.message);
    return false;
  }
}

module.exports = { enabled, status, notifyInquiry };
