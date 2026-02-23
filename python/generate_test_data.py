# generate_test_data.py
import numpy as np
import json

fs = 20000          # 采样率 20kHz
duration = 3        # 3 秒数据（60000点）
t = np.linspace(0, duration, int(fs * duration))

# 模拟真实脉搏波：基频1.2Hz + 二次谐波 + 三次谐波 + 适量噪声
signal = 1.2 + 0.3 * np.sin(2 * np.pi * 1.2 * t) + \
               0.15 * np.sin(2 * np.pi * 2.4 * t) + \
               0.07 * np.sin(2 * np.pi * 3.6 * t) + \
               0.03 * np.random.randn(len(t))
voltage_values = signal.tolist()

with open('test_data_3s.json', 'w') as f:
    json.dump(voltage_values, f)
print(f"✅ 生成 {len(voltage_values)} 个数据点，保存到 test_data_3s.json")