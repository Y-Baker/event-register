const fs = require('fs');

const sgMail = require('@sendgrid/mail')

const sendEmail = async (to, subject, text, attachments = []) => {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY)
  if (!to || !subject || !text) {
    throw new Error('Missing required email parameters');
  }

  let msg;

  try {
    msg = {
      to,
      from: process.env.EMAIL_USER,
      subject,
      text,
      attachments: attachments.map(file => {
        const fileContent = fs.readFileSync(file.path).toString('base64');
        return {
          content: fileContent,
          filename: file.filename,
          type: 'image/png',
          disposition: 'attachment',
        };
      }),
    };
  } catch (error) {
    console.error('Error reading attachment files:', error);
    throw new Error('Failed to read attachment files');
  }

  sgMail.send(msg)
    .then(() => {
      console.log(`✅ Email sent to ${to}`);
    })
    .catch((error) => {
      console.error('❌ Failed to send email:', error);
      throw new Error('Failed to send email');
    });

  return true;
};


module.exports = {
  sendEmail
};