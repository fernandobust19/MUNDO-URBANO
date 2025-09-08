const nodemailer = require('nodemailer');
const { smtp } = require('./config');

let transporter = null;
function getTx(){
  if(transporter) return transporter;
  if(!(smtp && smtp.host && smtp.user && smtp.pass)) throw new Error('SMTP no configurado');
  transporter = nodemailer.createTransport({ host: smtp.host, port: smtp.port||587, secure: (smtp.port==465), auth: { user: smtp.user, pass: smtp.pass } });
  return transporter;
}

async function sendEmail(record){
  const tx = getTx();
  const to = smtp.to || smtp.user;
  const text = `Nuevo registro:\nFecha: ${record.iso}\nUserId: ${record.userId}\nUsuario: ${record.username}\nNúmero: ${record.receiptNumber}`;
  await tx.sendMail({ from: smtp.user, to, subject: 'Nuevo número registrado', text });
}

module.exports = { sendEmail };
