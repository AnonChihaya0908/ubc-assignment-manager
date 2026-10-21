async function refreshBeforeDailyDigest({ browserVisible, hasCourses, hasPrairieTest, syncCourses, syncPrairieTest, onError }) {
  if (browserVisible) return { skippedForLogin: true };
  if (hasCourses) {
    try { await syncCourses(); }
    catch (error) { onError('课程', error); }
  }
  if (hasPrairieTest) {
    try { await syncPrairieTest(); }
    catch (error) { onError('PrairieTest', error); }
  }
  return { skippedForLogin: false };
}

module.exports = { refreshBeforeDailyDigest };
