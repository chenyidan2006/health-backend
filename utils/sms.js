// utils/sms.js
//发送验证码
const axios = require('axios');

// 假设您使用了阿里云短信服务
const sendSms = async (phone, code) => {
  // 这里需要您根据短信服务商的API实现
  // 示例：调用阿里云短信接口
  const params = {
    PhoneNumbers: phone,
    SignName: '您的签名',
    TemplateCode: '您的模板CODE',
    TemplateParam: JSON.stringify({ code })
  };
  // 实际发送逻辑...
  console.log(`发送验证码 ${code} 到手机 ${phone}`);
  return true;
};

module.exports = { sendSms };