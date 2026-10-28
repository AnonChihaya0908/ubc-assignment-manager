async function refreshBeforeDailyDigest({ browserVisible, hasCourses, hasPrairieTest, hasUbcFinals, syncCourses, syncPrairieTest, syncUbcFinals, onError }) {
  if (browserVisible) return { skippedForLogin: true };
  if (hasCourses) {
    try { await syncCourses(); }
    catch (error) { onError('课程', error); }
  }
  if (hasPrairieTest) {
    try { await syncPrairieTest(); }
    catch (error) { onError('PrairieTest', error); }
  }
  if (hasUbcFinals && syncUbcFinals) {
    try { await syncUbcFinals(); }
    catch (error) { onError('UBC 考试日程', error); }
  }
  return { skippedForLogin: false };
}

module.exports = { refreshBeforeDailyDigest };
