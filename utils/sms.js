// 以阿里云为例，需安装 @alicloud/sms-sdk
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