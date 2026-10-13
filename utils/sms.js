// 以阿里云为例,需安装 @alicloud/sms-sdk
/*
const SMSClient = require('@alicloud/sms-sdk');

const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
const secretAccessKey = process.env.ALIYUN_ACCESS_KEY_SECRET;
const signName = '您的短信签名';
const templateCode = '您的模板CODE';

const smsClient = new SMSClient({ accessKeyId, secretAccessKey });

const sendSms = async (phone, code) => {
  try {
    const res = await smsClient.sendSMS({
      PhoneNumbers: phone,
      SignName: signName,
      TemplateCode: templateCode,
      TemplateParam: JSON.stringify({ code })
    });
    if (res.Code === 'OK') {
      return true;
    } else {
      console.error(res);
      return false;
    }
  } catch (err) {
    console.error(err);
    return false;
  }
};

module.exports = { sendSms };
*/
// utils/sms.js - 模拟短信发送(仅开发测试用)
const sendSms = async (phone, code) => {
    // 模拟发送:在控制台打印验证码
    console.log(`[模拟短信] 向 ${phone} 发送验证码:${code}`);
    // 始终返回成功,方便调试
    return { success: true, message: '验证码已发送(模拟)' };
};

module.exports = { sendSms };