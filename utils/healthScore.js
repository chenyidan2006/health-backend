//utils/healthScore.js（评分算法，完全移植自云函数）
// 心率评分
function calculateHeartRateScore(heartRate) {
  if (!heartRate) return 0;
  if (heartRate >= 60 && heartRate <= 100) {
    const distance = Math.abs(heartRate - 80);
    return Math.max(0, 100 - distance * 2);
  }
  if (heartRate < 60) return Math.max(0, 100 - (60 - heartRate) * 3);
  if (heartRate > 100) return Math.max(0, 100 - (heartRate - 100) * 2);
  return 0;
}

// 血压评分
function calculateBPScore(systolic, diastolic) {
  if (!systolic || !diastolic) return 0;
  let score = 100;
  if (systolic < 90) score -= (90 - systolic) * 2;
  else if (systolic > 139) score -= (systolic - 139) * 2;
  if (diastolic < 60) score -= (60 - diastolic) * 2;
  else if (diastolic > 89) score -= (diastolic - 89) * 2;
  return Math.max(0, score);
}

// 血氧评分
function calculateSpO2Score(spo2) {
  if (!spo2) return 0;
  if (spo2 >= 95 && spo2 <= 100) return 100;
  if (spo2 >= 90 && spo2 < 95) return 60 + (spo2 - 90) * 8;
  if (spo2 < 90) return Math.max(0, 60 - (90 - spo2) * 5);
  return 0;
}

// 总体平衡分
function calculateOverallBalanceScore(heartRateScore, bpScore, spo2Score) {
  return heartRateScore * 0.4 + bpScore * 0.4 + spo2Score * 0.2;
}

// 体征状态分
function calculateVitalSignsScore(heartRateScore, bpScore, spo2Score) {
  return (heartRateScore + bpScore + spo2Score) / 3;
}

// 活动水平分
function calculateActivityLevelScore(heartRateScore) {
  return Math.min(100, heartRateScore * 1.1);
}

// 放松状态分
function calculateRelaxationScore(heartRateScore, bpScore) {
  const heartRateFactor = heartRateScore > 70 ? 100 - (heartRateScore - 70) * 2 : heartRateScore;
  const bpFactor = bpScore > 80 ? 100 - (bpScore - 80) * 1.5 : bpScore;
  return heartRateFactor * 0.6 + bpFactor * 0.4;
}

// 对外统一接口：根据健康数据计算所有评分
function calculateHealthScores(healthData) {
  const hrScore = calculateHeartRateScore(healthData.heart_rate);
  const bpScore = calculateBPScore(healthData.systolic_bp, healthData.diastolic_bp);
  const spo2Score = calculateSpO2Score(healthData.spo2);

  return {
    overall_balance: Math.round(calculateOverallBalanceScore(hrScore, bpScore, spo2Score)),
    vital_signs: Math.round(calculateVitalSignsScore(hrScore, bpScore, spo2Score)),
    activity_level: Math.round(calculateActivityLevelScore(hrScore)),
    relaxation_state: Math.round(calculateRelaxationScore(hrScore, bpScore)),
    heart_rate_score: Math.round(hrScore),
    blood_pressure_score: Math.round(bpScore),
    spo2_score: Math.round(spo2Score)
  };
}

module.exports = {
  calculateHealthScores,
  calculateHeartRateScore,
  calculateBPScore,
  calculateSpO2Score
};