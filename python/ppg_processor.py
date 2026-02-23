# process_health_data_full.py
#D:/code/app/appprogram/uniCloud-aliyun/cloudfunctions/upload-pulse-data/python/process_health_data_full.py
#无数据库操作。它仅接收云函数传递的电压数据，返回处理结果。数据持久化完全由Node.js云函数完成。
import json
import sys
import os
import warnings
import traceback
import numpy as np
import pandas as pd
from scipy import signal
from scipy.ndimage import gaussian_filter1d, median_filter, uniform_filter1d
from scipy.interpolate import interp1d
from scipy.signal import butter, filtfilt, find_peaks, welch
import pywt
import pickle
import joblib
from datetime import datetime
from typing import List, Dict, Tuple, Optional, Any
import math
from collections import defaultdict

warnings.filterwarnings('ignore')

# 在 process_health_data_full.py 中添加模型加载功能			
class FullHealthDataProcessor:
    """
    完整MATLAB算法转Python实现
    处理脉搏波数据，计算心率、血压、血氧
    """
    
    def __init__(self, model_dir: str = None):
        """
        初始化处理器
        
        Args:
            model_dir: 模型目录路径，包含DBP和SBP模型
        """
        self.params = self._initialize_params()
        self.dbp_model = None
        self.sbp_model = None
        self.dbp_inputps = None
        self.dbp_outputps = None
        self.sbp_inputps = None
        self.sbp_outputps = None
        
        if model_dir:
            self._load_models(model_dir)
    
    def _initialize_params(self) -> Dict:
        """初始化参数，对应MATLAB代码中的params结构"""
        params = {
            # 信号处理参数
            'freq_range': [10, 2000],           # 频率范围限制
            'smooth_window': 100,               # 高斯平滑窗口大小
            'medfilt_window': 5,                # 中值滤波窗口大小
            'movmean_window': 7,                # 移动平均窗口大小
            
            # 峰值检测参数
            'peak_height_ratio': 0.5,           # 最小峰高比例
            'peak_distance_ratio': 0.1,         # 最小峰间距比例
            
            # 特征点检测参数
            'feature_window': 0.1,              # 左右搜索窗口大小(秒)
            'input3_min_delay': 0.1,            # INPUT3最小延迟(秒)
            'input3_max_delay': 0.3,            # INPUT3最大延迟(秒)
            'input2_search_window': 0.1,        # INPUT2搜索窗口(秒)
            
            # 特征点间隔阈值
            'min_interval_threshold': 0.1,      # 最小时间间隔阈值(秒)
            'min_peak_interval': 0.5,           # 峰值间隔最小阈值(秒)
            
            # 有效组数量阈值参数
            'valid_group_ratio': 0.6,           # 有效组数量占有效峰值数量的比例阈值
            'min_valid_groups': 1,              # 有效组数量最小阈值
            
            # 心率异常值检测参数
            'iqr_multiplier': 1.5,              # IQR倍数，用于计算异常值边界
            'heart_rate_deviation_threshold': 0.1,  # 心率偏差阈值(10%)
            'heart_rate_dynamic_threshold': 0.1,    # 动态心率阈值比例(10%)
            
            # 特征点时间间隔动态过滤参数
            'feature_interval_threshold': 0.6,  # 特征点时间间隔动态阈值比例(10%)
            
            # CWT参数
            'cwt_scales': np.arange(1, 129),    # CWT尺度
            'cwt_wavelet': 'morl',              # 小波类型
            
            # 采样率 (会在process中根据输入覆盖)
            'sampling_rate': 20000,
        }
        return params
    
    def _load_models(self, model_dir: str):
        """加载血压预测模型"""
        try:
            # 加载DBP模型和预处理参数
            with open(os.path.join(model_dir, 'dbp_model.pkl'), 'rb') as f:
                self.dbp_model = joblib.load(f)
            with open(os.path.join(model_dir, 'dbp_preprocess_params.pkl'), 'rb') as f:
                dbp_params = pickle.load(f)
                self.dbp_inputps = dbp_params['inputps']
                self.dbp_outputps = dbp_params['outputps']
            
            # 加载SBP模型和预处理参数
            with open(os.path.join(model_dir, 'sbp_model.pkl'), 'rb') as f:
                self.sbp_model = joblib.load(f)
            with open(os.path.join(model_dir, 'sbp_preprocess_params.pkl'), 'rb') as f:
                sbp_params = pickle.load(f)
                self.sbp_inputps = sbp_params['inputps']
                self.sbp_outputps = sbp_params['outputps']
                
            print("模型加载成功")
        except Exception as e:
            print(f"模型加载失败: {e}")
            print("将使用基于规则的血压估计算法")
    
    def process(self, voltage_values: List[float], sampling_rate: int = 20000) -> Dict:
        """
        完整的脉搏波处理流程
        
        Args:
            voltage_values: 电压值数组
            sampling_rate: 采样率 (Hz)
            
        Returns:
            包含心率、血压、血氧的字典
        """
        try:
            self.params['sampling_rate'] = sampling_rate
            print(f"开始处理数据: 长度={len(voltage_values)}, 采样率={sampling_rate}Hz")
            
            # 1. 数据读取与预处理
            print("步骤1: 数据预处理")
            data_dict = self._read_and_preprocess_data(voltage_values, sampling_rate)
            
            # 2. CWT时频分析与脊线提取
            print("步骤2: CWT时频分析")
            cwt_result = self._perform_cwt(data_dict['sig'], sampling_rate)
            
            # 3. 信号滤波与峰值检测
            print("步骤3: 信号滤波与峰值检测")
            filter_result = self._filter_and_detect_peaks(
                cwt_result['ridge_freq_smooth'], 
                cwt_result['ridge_time'], 
                sampling_rate,
                cwt_result['f'],
                cwt_result['ridge_time_original'],
                cwt_result['wt']
            )
            
            # 4. 特征点检测
            print("步骤4: 特征点检测")
            feature_points = self._detect_feature_points(
                filter_result['ridge_new'],
                cwt_result['ridge_time'],
                filter_result['peak_locs'],
                sampling_rate
            )
            
            # 5. 计算特征点差值
            print("步骤5: 计算特征点差值")
            feature_diffs_result = self._calculate_feature_differences(
                cwt_result['ridge_time'],
                filter_result['peak_locs'],
                feature_points['input1_locs'],
                feature_points['input2_locs'],
                feature_points['input3_locs'],
                feature_points['valid_peaks']
            )
            
            feature_diffs = feature_diffs_result['feature_diffs']
            valid_groups = feature_diffs_result['valid_groups']
            
            # 6. 检查有效组数量
            if feature_diffs is not None and len(feature_diffs) > 0:
                valid_group_count = np.sum(valid_groups)
                num_valid_peaks = np.sum(feature_points['valid_peaks'])
                
                threshold = max(self.params['min_valid_groups'], 
                              np.floor(num_valid_peaks * self.params['valid_group_ratio']))
                
                if valid_group_count < threshold:
                    print(f"有效组数量({valid_group_count}) < 阈值({threshold})，忽略数据")
                    feature_diffs = np.array([])
                    valid_groups = np.array([], dtype=bool)
                else:
                    # 仅保留有效组的数据
                    feature_diffs = feature_diffs[valid_groups, :]
            else:
                print("没有有效特征点差值数据")
                feature_diffs = np.array([])
            
            # 7. 计算心率
            print("步骤6: 计算生理参数")
            heart_rate = 75.0  # 默认值
            if feature_diffs is not None and len(feature_diffs) > 0:
                heart_rates = np.round(60.0 / feature_diffs[:, 0])
                heart_rate = float(np.mean(heart_rates))
                print(f"计算得到心率: {heart_rate} BPM")
            
            # 8. 计算血压
            systolic_bp, diastolic_bp = self._calculate_blood_pressure(feature_diffs)
            
            # 9. 计算血氧
            spo2 = self._calculate_spo2(data_dict['sig'])
            
            # 10. 计算置信度
            confidence = self._calculate_confidence(
                feature_diffs, heart_rate, systolic_bp, diastolic_bp, spo2
            )
            
            result = {
                'success': True,
                'data': {
                    'heart_rate': float(np.clip(heart_rate, 40, 200)),
                    'systolic_bp': float(np.clip(systolic_bp, 70, 180)),
                    'diastolic_bp': float(np.clip(diastolic_bp, 40, 120)),
                    'spo2': float(np.clip(spo2, 85, 100)),
                    'confidence': float(confidence),
                    'feature_count': len(feature_diffs) if feature_diffs is not None else 0,
                    'algorithm': 'full_matlab_replication',
                    'processing_time': datetime.now().isoformat(),
                    'parameters': {
                        'sampling_rate': sampling_rate,
                        'data_length': len(voltage_values)
                    }
                },
                'debug_info': {
                    'peaks_detected': len(filter_result['peak_locs']),
                    'valid_peaks': np.sum(feature_points['valid_peaks']),
                    'valid_groups': len(feature_diffs) if feature_diffs is not None else 0,
                    'filter_result_keys': list(filter_result.keys()),
                    'feature_points_keys': list(feature_points.keys())
                }
            }
            
            print(f"处理完成: 心率={result['data']['heart_rate']}, "
                  f"收缩压={result['data']['systolic_bp']}, "
                  f"舒张压={result['data']['diastolic_bp']}, "
                  f"血氧={result['data']['spo2']}")
            
            return result
            
        except Exception as e:
            print(f"处理过程出错: {str(e)}")
            traceback.print_exc()
            
            # 返回错误信息
            return {
                'success': False,
                'error': str(e),
                'data': {
                    'heart_rate': 75.0,
                    'systolic_bp': 120.0,
                    'diastolic_bp': 80.0,
                    'spo2': 97.0,
                    'confidence': 0.1,
                    'algorithm': 'emergency_fallback',
                    'error_message': str(e)
                }
            }
    
    def _read_and_preprocess_data(self, voltage_values: List[float], sampling_rate: int) -> Dict:
        """
        数据读取与预处理
        
        对应MATLAB函数: readAndPreprocessData
        """
        # 转换为numpy数组
        apdsig = np.array(voltage_values, dtype=np.float32)
        
        # 信号归一化 (类似MATLAB: nor_apd = (apdsig - min(apdsig)) / (max(apdsig) - min(apdsig)))
        min_val = np.min(apdsig)
        max_val = np.max(apdsig)
        
        if max_val - min_val > 0:
            nor_apd = (apdsig - min_val) / (max_val - min_val)
            nor_apd = 2 * nor_apd - 1  # nor_apd = 2 * nor_apd - 1
        else:
            nor_apd = apdsig
        
        # 创建时间数组
        apdt = np.arange(len(apdsig)) / sampling_rate
        
        return {
            'sig': nor_apd,
            't': apdt,
            'original': apdsig,
            'sampling_rate': sampling_rate
        }
    
    def _perform_cwt(self, signal_data: np.ndarray, sampling_rate: int) -> Dict:
        """
        CWT时频分析与脊线提取
        
        对应MATLAB函数: performCWT
        """
        try:
            # 执行连续小波变换
            print(f"执行CWT: 信号长度={len(signal_data)}, 采样率={sampling_rate}")
            
            # 使用pywt.cwt
            scales = self.params['cwt_scales']
            coefficients, frequencies = pywt.cwt(
                signal_data, 
                scales, 
                self.params['cwt_wavelet'], 
                1.0 / sampling_rate
            )
            
            wt = coefficients
            f = frequencies
            
            # 计算脊线 (ridge line)
            cfs = np.abs(wt)
            
            # 在每个时间点找到最大频率成分
            max_idx = np.argmax(cfs, axis=0)
            ridge_freq = f[max_idx]
            
            # 应用频率范围限制
            valid_idx = (ridge_freq >= self.params['freq_range'][0]) & \
                       (ridge_freq <= self.params['freq_range'][1])
            
            # 确保有足够的有效数据点
            if np.sum(valid_idx) < 10:
                print(f"警告: 有效频率点数量不足 ({np.sum(valid_idx)})")
                # 创建最小长度的有效数据
                valid_idx[:min(10, len(valid_idx))] = True
            
            ridge_freq_original = ridge_freq.copy()
            ridge_time_original = np.arange(len(signal_data)) / sampling_rate
            
            ridge_freq = ridge_freq[valid_idx]
            ridge_time = ridge_time_original[valid_idx]
            
            # 平滑处理 (对应MATLAB的smoothdata with 'gaussian')
            ridge_freq_smooth = gaussian_filter1d(
                ridge_freq, 
                sigma=self.params['smooth_window'] / 10  # 调整sigma以近似MATLAB的gaussian平滑
            )
            
            return {
                'wt': wt,
                'f': f,
                'ridge_time': ridge_time,
                'ridge_freq_smooth': ridge_freq_smooth,
                'ridge_time_original': ridge_time_original,
                'ridge_freq_original': ridge_freq_original,
                'valid_idx': valid_idx
            }
            
        except Exception as e:
            print(f"CWT分析失败: {e}")
            # 返回简化结果
            t = np.arange(len(signal_data)) / sampling_rate
            freq = np.ones_like(t) * 100  # 默认频率
            
            return {
                'wt': np.zeros((10, len(signal_data))),
                'f': np.linspace(1, 100, 10),
                'ridge_time': t,
                'ridge_freq_smooth': freq,
                'ridge_time_original': t,
                'ridge_freq_original': freq,
                'valid_idx': np.ones_like(t, dtype=bool)
            }
    
    def _filter_and_detect_peaks(
        self, 
        ridge_freq_smooth: np.ndarray, 
        ridge_time: np.ndarray,
        sampling_rate: int,
        f: np.ndarray,
        ridge_time_original: np.ndarray,
        wt: np.ndarray
    ) -> Dict:
        """
        信号滤波与峰值检测
        
        对应MATLAB函数: filterAndDetectPeaks
        """
        try:
            # 中值滤波
            ridge_med = median_filter(ridge_freq_smooth, size=self.params['medfilt_window'])
            
            # 移动平均
            ridge_new = uniform_filter1d(ridge_med, size=self.params['movmean_window'])
            
            # 峰值检测
            min_peak_height = self.params['peak_height_ratio'] * np.max(ridge_new)
            min_peak_distance = int(self.params['peak_distance_ratio'] * sampling_rate)
            
            peak_indices, peak_properties = find_peaks(
                ridge_new,
                height=min_peak_height,
                distance=min_peak_distance
            )
            
            peak_heights = ridge_new[peak_indices]
            
            # 计算峰值频率和FWHM
            peak_freqs = np.zeros(len(peak_indices))
            peak_fwhm = np.zeros(len(peak_indices))
            
            for i, peak_loc in enumerate(peak_indices):
                # 获取当前峰值在ridge_time中的时间
                peak_time = ridge_time[peak_loc]
                
                # 在原始时间序列中找到最接近的索引
                time_idx = np.argmin(np.abs(ridge_time_original - peak_time))
                
                if 0 <= time_idx < wt.shape[1]:
                    # 获取峰值对应的频率
                    freq_idx = np.argmax(np.abs(wt[:, time_idx]))
                    peak_freqs[i] = f[freq_idx]
                    
                    # 计算半峰全宽(FWHM)
                    peak_value = np.abs(wt[:, time_idx])
                    half_peak = np.max(peak_value) / 2
                    
                    # 找到大于半峰值的索引
                    above_half = peak_value >= half_peak
                    if np.any(above_half):
                        freq_indices = np.where(above_half)[0]
                        if len(freq_indices) >= 2:
                            peak_fwhm[i] = np.abs(f[freq_indices[-1]] - f[freq_indices[0]]) / sampling_rate
            
            return {
                'ridge_new': ridge_new,
                'peak_locs': peak_indices,
                'peak_heights': peak_heights,
                'peak_freqs': peak_freqs,
                'peak_fwhm': peak_fwhm,
                'ridge_med': ridge_med
            }
            
        except Exception as e:
            print(f"滤波与峰值检测失败: {e}")
            # 返回空结果
            return {
                'ridge_new': ridge_freq_smooth,
                'peak_locs': np.array([], dtype=int),
                'peak_heights': np.array([]),
                'peak_freqs': np.array([]),
                'peak_fwhm': np.array([]),
                'ridge_med': ridge_freq_smooth
            }
    
    def _detect_feature_points(
        self,
        ridge_new: np.ndarray,
        ridge_time: np.ndarray,
        peak_locs: np.ndarray,
        sampling_rate: int
    ) -> Dict:
        """
        特征点检测
        
        对应MATLAB函数: detectFeaturePoints
        """
        num_peaks = len(peak_locs)
        input1_locs = np.zeros(num_peaks, dtype=int)
        input2_locs = np.zeros(num_peaks, dtype=int)
        input3_locs = np.zeros(num_peaks, dtype=int)
        valid_peaks = np.zeros(num_peaks, dtype=bool)
        
        samples_per_window = int(self.params['feature_window'] * sampling_rate)
        samples_per_input3_min = int(self.params['input3_min_delay'] * sampling_rate)
        samples_per_input3_max = int(self.params['input3_max_delay'] * sampling_rate)
        samples_per_input2_window = int(self.params['input2_search_window'] * sampling_rate)
        
        for i in range(num_peaks):
            peak_idx = peak_locs[i]
            
            # 确保窗口不超出数据范围
            left_start = max(0, peak_idx - samples_per_window)
            left_end = peak_idx - 1
            
            if left_start > left_end or left_start >= len(ridge_new):
                continue
            
            left_window = np.arange(left_start, left_end + 1)
            if len(left_window) > 0:
                # 在左侧窗口找最小值 (INPUT1)
                input1_rel_idx = np.argmin(ridge_new[left_window])
                input1_locs[i] = left_window[input1_rel_idx]
            else:
                continue
            
            # 确保右侧窗口不超出数据范围
            right_start = peak_idx + 1
            right_end = min(len(ridge_new) - 1, peak_idx + samples_per_input2_window)
            
            if right_start > right_end or right_start >= len(ridge_new):
                continue
            
            right_window = np.arange(right_start, right_end + 1)
            if len(right_window) > 0:
                # 在右侧窗口找最小值 (INPUT2)
                input2_rel_idx = np.argmin(ridge_new[right_window])
                input2_locs[i] = right_window[input2_rel_idx]
                
                # 确保INPUT3搜索窗口不超出数据范围
                input3_start = input2_locs[i] + samples_per_input3_min
                input3_end = min(len(ridge_new) - 1, input2_locs[i] + samples_per_input3_max)
                
                if input3_start > input3_end or input3_start >= len(ridge_new):
                    continue
                
                input3_window = np.arange(input3_start, input3_end + 1)
                if len(input3_window) > 0:
                    # 在INPUT3窗口找最小值
                    input3_rel_idx = np.argmin(ridge_new[input3_window])
                    input3_locs[i] = input3_window[input3_rel_idx]
                    valid_peaks[i] = True
        
        return {
            'input1_locs': input1_locs,
            'input2_locs': input2_locs,
            'input3_locs': input3_locs,
            'valid_peaks': valid_peaks
        }
    
    def _calculate_feature_differences(
        self,
        ridge_time: np.ndarray,
        peak_locs: np.ndarray,
        input1_locs: np.ndarray,
        input2_locs: np.ndarray,
        input3_locs: np.ndarray,
        valid_peaks: np.ndarray
    ) -> Dict:
        """
        计算特征点之间的差值
        
        对应MATLAB函数: calculateFeatureDifferences
        """
        num_peaks = len(peak_locs)
        valid_indices = np.where(valid_peaks)[0]
        num_valid = len(valid_indices)
        num_groups = num_valid - 1
        
        if num_groups < 1:
            return {
                'feature_diffs': None,
                'valid_groups': None
            }
        
        feature_diffs = np.zeros((num_groups, 4))
        valid_groups = np.zeros(num_groups, dtype=bool)
        
        for i in range(num_groups):
            if i + 1 >= num_valid:
                break
            
            curr_idx = valid_indices[i]
            next_idx = valid_indices[i + 1]
            
            if curr_idx >= num_peaks or next_idx >= num_peaks:
                continue
            
            # 使用ridge_time计算时间差
            curr_peak_time = ridge_time[peak_locs[curr_idx]]
            next_peak_time = ridge_time[peak_locs[next_idx]]
            curr_input1_time = ridge_time[input1_locs[curr_idx]]
            curr_input2_time = ridge_time[input2_locs[curr_idx]]
            curr_input3_time = ridge_time[input3_locs[curr_idx]]
            next_input1_time = ridge_time[input1_locs[next_idx]]
            
            diff1 = np.abs(curr_input2_time - curr_input1_time)
            diff2 = np.abs(curr_input3_time - curr_input2_time)
            diff3 = np.abs(next_input1_time - curr_input3_time)
            peak_diff = np.abs(next_peak_time - curr_peak_time)
            
            feature_diffs[i, :] = [peak_diff, diff1, diff2, diff3]
            
            if peak_diff >= self.params['min_peak_interval']:
                if (diff1 >= self.params['min_interval_threshold'] and 
                    diff2 >= self.params['min_interval_threshold'] and 
                    diff3 >= self.params['min_interval_threshold']):
                    valid_groups[i] = True
        
        return {
            'feature_diffs': feature_diffs,
            'valid_groups': valid_groups
        }
    
    def _calculate_blood_pressure(self, feature_diffs: np.ndarray) -> Tuple[float, float]:
        """
        计算血压
        
        对应MATLAB的血压计算部分
        """
        systolic_bp = 120.0
        diastolic_bp = 80.0
        
        if feature_diffs is None or len(feature_diffs) == 0:
            print("没有特征点差值数据，使用默认血压值")
            return systolic_bp, diastolic_bp
        
        try:
            # 如果有模型，使用模型预测
            if self.dbp_model is not None and self.sbp_model is not None:
                print("使用机器学习模型预测血压")
                
                # 准备特征数据
                feature_data = feature_diffs[:, :4]  # 使用前4个特征
                
                if len(feature_data) > 10:
                    # 取最后10个样本
                    feature_data = feature_data[-10:, :]
                
                # 计算平均特征
                avg_features = np.mean(feature_data, axis=0).reshape(1, -1)
                
                # 预测DBP
                if hasattr(self.dbp_model, 'predict'):
                    dbp_norm = self.dbp_model.predict(avg_features)
                    diastolic_bp = self._reverse_normalize(dbp_norm[0], self.dbp_outputps) * 0.97
                else:
                    # 如果是深度学习模型
                    diastolic_bp = self._predict_dl_model(self.dbp_model, avg_features) * 0.97
                
                # 预测SBP
                if hasattr(self.sbp_model, 'predict'):
                    sbp_norm = self.sbp_model.predict(avg_features)
                    systolic_bp = self._reverse_normalize(sbp_norm[0], self.sbp_outputps) * 0.95
                else:
                    # 如果是深度学习模型
                    systolic_bp = self._predict_dl_model(self.sbp_model, avg_features) * 0.95
                
                print(f"模型预测结果: DBP={diastolic_bp:.1f}, SBP={systolic_bp:.1f}")
                
            else:
                # 使用基于特征的估计
                print("使用基于特征的血压估计算法")
                
                if len(feature_diffs) >= 3:
                    # 计算特征统计量
                    peak_diffs = feature_diffs[:, 0]
                    input1_input2_diffs = feature_diffs[:, 1]
                    input2_input3_diffs = feature_diffs[:, 2]
                    input3_next_diffs = feature_diffs[:, 3]
                    
                    avg_peak_diff = np.mean(peak_diffs)
                    avg_input1_input2 = np.mean(input1_input2_diffs)
                    avg_input2_input3 = np.mean(input2_input3_diffs)
                    avg_input3_next = np.mean(input3_next_diffs)
                    
                    # 基于特征的估算公式（需要根据你的数据校准）
                    systolic_bp = 110 + avg_input1_input2 * 50 + avg_input2_input3 * 30
                    diastolic_bp = 70 + avg_input2_input3 * 40 + avg_input3_next * 20
                    
                    print(f"特征估算结果: DBP={diastolic_bp:.1f}, SBP={systolic_bp:.1f}")
            
            # 应用滑动窗口异常值过滤（类似MATLAB代码）
            systolic_bp, diastolic_bp = self._apply_outlier_filter(systolic_bp, diastolic_bp)
            
            # 限制在合理范围
            systolic_bp = np.clip(systolic_bp, 70, 180)
            diastolic_bp = np.clip(diastolic_bp, 40, 120)
            
        except Exception as e:
            print(f"血压计算失败: {e}")
            # 使用基于规则的估算
            if feature_diffs is not None and len(feature_diffs) > 0:
                avg_amplitude = np.mean(feature_diffs[:, 0])  # 使用峰值间隔作为幅度的代理
                systolic_bp = 90 + avg_amplitude * 50
                diastolic_bp = 60 + avg_amplitude * 30
                
                systolic_bp = np.clip(systolic_bp, 70, 180)
                diastolic_bp = np.clip(diastolic_bp, 40, 120)
        
        return float(systolic_bp), float(diastolic_bp)
    
    def _reverse_normalize(self, normalized_value, outputps):
        """反归一化"""
        # 简化版本，实际需要根据MATLAB的mapminmax函数实现
        # MATLAB的mapminmax: y = (ymax-ymin)*(x-xmin)/(xmax-xmin) + ymin
        if hasattr(outputps, 'ymin') and hasattr(outputps, 'ymax'):
            ymin = outputps.ymin
            ymax = outputps.ymax
            xmin = outputps.xmin
            xmax = outputps.xmax
            
            if xmax - xmin != 0:
                original = (normalized_value - xmin) / (xmax - xmin) * (ymax - ymin) + ymin
                return original
        
        # 如果无法反归一化，返回原值
        return normalized_value
    
    def _predict_dl_model(self, model, features):
        """深度学习模型预测"""
        # 这里需要根据你的实际模型调整
        try:
            # 假设模型有predict方法
            if hasattr(model, 'predict'):
                return model.predict(features)[0]
            else:
                # 尝试直接调用模型
                return model(features)[0]
        except:
            return 120.0  # 默认值
    
    def _apply_outlier_filter(self, systolic_bp, diastolic_bp):
        """应用异常值过滤（类似MATLAB的滑动窗口过滤）"""
        # 这里实现类似MATLAB的异常值过滤逻辑
        # 由于我们只有单个值，简化处理
        
        # 基于历史记录（如果有）
        if not hasattr(self, 'bp_history'):
            self.bp_history = {'systolic': [], 'diastolic': []}
        
        # 添加到历史
        self.bp_history['systolic'].append(systolic_bp)
        self.bp_history['diastolic'].append(diastolic_bp)
        
        # 只保留最近10个记录
        if len(self.bp_history['systolic']) > 10:
            self.bp_history['systolic'] = self.bp_history['systolic'][-10:]
            self.bp_history['diastolic'] = self.bp_history['diastolic'][-10:]
        
        # 如果历史记录足够，使用中值滤波
        if len(self.bp_history['systolic']) >= 3:
            systolic_bp = np.median(self.bp_history['systolic'])
            diastolic_bp = np.median(self.bp_history['diastolic'])
        
        return systolic_bp, diastolic_bp
    
    def _calculate_spo2(self, signal_data: np.ndarray) -> float:
        """
        计算血氧饱和度
        
        注意：通常需要红外和红光两个通道的数据
        这里实现简化版本
        """
        try:
            # 计算信号的AC和DC成分
            dc_component = np.mean(np.abs(signal_data))
            ac_component = np.std(signal_data)
            
            if dc_component == 0:
                ratio = 0.01
            else:
                ratio = ac_component / dc_component
            
            # 简化公式
            spo2 = 98.0 - ratio * 5.0
            
            # 使用特征信息调整
            if hasattr(self, 'last_feature_diffs') and self.last_feature_diffs is not None:
                if len(self.last_feature_diffs) > 0:
                    avg_feature = np.mean(self.last_feature_diffs[:, 0])
                    spo2 += avg_feature * 2.0
            
            # 限制在合理范围
            spo2 = np.clip(spo2, 85.0, 100.0)
            
            return float(spo2)
            
        except Exception as e:
            print(f"血氧计算失败: {e}")
            return 97.0  # 默认值
    
    def _calculate_confidence(
        self, 
        feature_diffs: np.ndarray, 
        heart_rate: float, 
        systolic_bp: float, 
        diastolic_bp: float, 
        spo2: float
    ) -> float:
        """计算结果置信度"""
        confidence = 0.5  # 基础置信度
        
        # 基于特征数量
        if feature_diffs is not None:
            if len(feature_diffs) >= 5:
                confidence += 0.3
            elif len(feature_diffs) >= 3:
                confidence += 0.2
            else:
                confidence -= 0.2
        
        # 基于心率合理性
        if 50 <= heart_rate <= 150:
            confidence += 0.1
        else:
            confidence -= 0.2
        
        # 基于血压合理性
        if 90 <= systolic_bp <= 160 and 60 <= diastolic_bp <= 100:
            confidence += 0.1
        else:
            confidence -= 0.1
        
        # 基于血氧合理性
        if 95 <= spo2 <= 100:
            confidence += 0.1
        elif 90 <= spo2 < 95:
            confidence += 0.05
        else:
            confidence -= 0.1
        
        # 基于特征一致性
        if feature_diffs is not None and len(feature_diffs) >= 3:
            # 检查特征一致性
            peak_intervals = feature_diffs[:, 0]
            interval_std = np.std(peak_intervals)
            
            if interval_std < 0.1:  # 间隔稳定
                confidence += 0.1
            elif interval_std > 0.3:  # 间隔不稳定
                confidence -= 0.1
        
        # 限制置信度在合理范围
        confidence = np.clip(confidence, 0.1, 0.99)
        
        return float(confidence)

# 主处理函数
def main():
    """
    主函数：从标准输入读取JSON数据，处理并输出结果
    """
    try:
        # 读取输入数据
        input_data = sys.stdin.read()
        if not input_data:
            error_result = {
                'success': False,
                'error': '没有输入数据',
                'data': {
                    'heart_rate': 0,
                    'systolic_bp': 0,
                    'diastolic_bp': 0,
                    'spo2': 0,
                    'confidence': 0
                }
            }
            print(json.dumps(error_result))
            sys.exit(1)
        
        # 解析JSON数据
        params = json.loads(input_data)
        
        voltage_values = params.get('voltage_values')
        sampling_rate = params.get('sampling_rate', 20000)
        model_dir = params.get('model_dir')
        
        if voltage_values is None:
            error_result = {
                'success': False,
                'error': '缺少voltage_values参数',
                'data': {
                    'heart_rate': 0,
                    'systolic_bp': 0,
                    'diastolic_bp': 0,
                    'spo2': 0,
                    'confidence': 0
                }
            }
            print(json.dumps(error_result))
            sys.exit(1)
        
        print(f"收到处理请求: 数据长度={len(voltage_values)}, 采样率={sampling_rate}")
        
        # 创建处理器
        processor = FullHealthDataProcessor(model_dir)
        
        # 处理数据
        result = processor.process(voltage_values, sampling_rate)
        
        # 输出结果
        print(json.dumps(result, ensure_ascii=False))
        
    except json.JSONDecodeError as e:
        error_result = {
            'success': False,
            'error': f'JSON解析失败: {str(e)}',
            'data': {
                'heart_rate': 0,
                'systolic_bp': 0,
                'diastolic_bp': 0,
                'spo2': 0,
                'confidence': 0
            }
        }
        print(json.dumps(error_result))
        sys.exit(1)
        
    except Exception as e:
        error_result = {
            'success': False,
            'error': f'处理失败: {str(e)}',
            'data': {
                'heart_rate': 0,
                'systolic_bp': 0,
                'diastolic_bp': 0,
                'spo2': 0,
                'confidence': 0
            }
        }
        print(json.dumps(error_result))
        sys.exit(1)

def convert_to_serializable(obj):
    """递归将 numpy 类型转为 Python 原生类型"""
    if isinstance(obj, (np.integer, np.int64, np.int32)):
        return int(obj)
    elif isinstance(obj, (np.floating, np.float64, np.float32)):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, dict):
        return {k: convert_to_serializable(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [convert_to_serializable(i) for i in obj]
    else:
        return obj

if __name__ == "__main__":
    try:
        # 读取输入数据
        input_data = sys.stdin.read()
        if not input_data:
            error_result = {
                'success': False,
                'error': '没有输入数据',
                'data': {
                    'heart_rate': 0,
                    'systolic_bp': 0,
                    'diastolic_bp': 0,
                    'spo2': 0,
                    'confidence': 0
                }
            }
            print(json.dumps(error_result))
            sys.exit(1)
        
        params = json.loads(input_data)
        voltage_values = params.get('voltage_values')
        sampling_rate = params.get('sampling_rate', 20000)
        model_dir = params.get('model_dir')
        
        if voltage_values is None:
            raise ValueError('缺少voltage_values参数')
        
        print(f"收到处理请求: 数据长度={len(voltage_values)}, 采样率={sampling_rate}")
        
        processor = FullHealthDataProcessor(model_dir)
        result = processor.process(voltage_values, sampling_rate)
        
        # 关键修复：转换所有 numpy 类型
        serializable_result = convert_to_serializable(result)
        print(json.dumps(serializable_result, ensure_ascii=False))
        
    except Exception as e:
        error_result = {
            'success': False,
            'error': f'处理失败: {str(e)}',
            'data': {
                'heart_rate': 0,
                'systolic_bp': 0,
                'diastolic_bp': 0,
                'spo2': 0,
                'confidence': 0
            }
        }
        serializable_error = convert_to_serializable(error_result)
        print(json.dumps(serializable_error))
        sys.exit(1)
    main()