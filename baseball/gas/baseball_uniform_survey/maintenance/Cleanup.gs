/**
 * retention 期限後の cleanup（Issue #383）。dry-run → 明示確認（confirmation_code）→ execute。
 *
 * - dry-run は一切書き込まず、件数と storage 名だけを返す（回答本文・自由記述・hash は出さない）。
 * - execute は retention 未確定・期限前・confirmation なし／不一致・final snapshot 必須なのに未 finalize の場合は拒否する。
 * - コードから削除できない storage は manual_required として dry-run に出し、完了を明示的に記録するまで完了扱いにしない。
 * - 削除後に再 scan し、対象が残っていれば成功扱いにしない。audit には件数・storage 名・成否だけを残す。
 */
function manualDone_() {
  try {
    var parsed = JSON.parse(getProperty_(PROP_MANUAL_CLEANUP_DONE) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

function cleanupPorts_(now) {
  return {
    now: now,
    policy: retentionPolicy_(now),
    sha256: sha256Hex_,
    countStorages: countStorages_,
    finalizedOk: function () {
      var status = getFinalizedStatus_();
      return status.state === 'finalized' && status.snapshot_verified === true;
    },
    manualDone: manualDone_,
    deleteStorage: deleteStorage_,
    appendAudit: function (entry) {
      var list = SurveyMaintenance.appendAuditList(getProperty_(PROP_CLEANUP_AUDIT), entry);
      setProperty_(PROP_CLEANUP_AUDIT, JSON.stringify(list));
    }
  };
}

function cleanupDryRun_() {
  return SurveyMaintenance.cleanupDryRun(cleanupPorts_(currentTime_()));
}

function cleanupExecute_(confirmation) {
  return withLock_(function () {
    var result = SurveyMaintenance.cleanupExecute(cleanupPorts_(currentTime_()), confirmation);
    logEvent_('cleanup', { status: result.status });
    return result;
  });
}

/** manual_required の storage を Owner が手動で処理し終えたことを記録する（未知の storage・自動削除対象は拒否）。 */
function confirmManualCleanup_(storageId) {
  var storage = SurveyMaintenance.storageById(storageId);
  if (!storage || storage.automation !== 'manual_required') throw new Error('invalid_request');
  return withLock_(function () {
    var done = manualDone_();
    done[storageId] = true;
    setProperty_(PROP_MANUAL_CLEANUP_DONE, JSON.stringify(done));
    logEvent_('manual_cleanup_recorded', { storage: storageId });
    return { ok: true, storage: storageId };
  });
}
