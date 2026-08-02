/* ============================================================
 * Дампир не восстанавливает кости хитов на длинном отдыхе
 * ============================================================ */

const DHAMPIR_MODULE_ID = "status-effects";
const NO_HIT_DICE_RECOVERY_FLAG = "noHitDiceRecovery";

Hooks.on("dnd5e.preRestCompleted", (actor, result, config) => {
  try {
    if (!actor || !result) return;

    const noRecovery = actor.getFlag(
      DHAMPIR_MODULE_ID,
      NO_HIT_DICE_RECOVERY_FLAG
    );

    if (noRecovery !== true) return;

    const isLongRest =
      config?.type === "long" ||
      result?.type === "long" ||
      result?.longRest === true;

    if (!isLongRest) return;

    const itemUpdates = Array.isArray(result.updateItems)
      ? result.updateItems
      : [];

    /*
     * Для каждого предмета класса возвращаем количество
     * потраченных костей хитов к значению до отдыха.
     */
    for (const update of itemUpdates) {
      const classItem = actor.items.get(update?._id);

      if (!classItem || classItem.type !== "class") continue;

      const currentSpent = Number(
        classItem.system?.hd?.spent ?? 0
      );

      /*
       * Большинство обновлений Foundry используют
       * плоский путь свойства.
       */
      update["system.hd.spent"] = currentSpent;

      /*
       * Защита на случай вложенного формата обновления.
       */
      if (update.system?.hd) {
        update.system.hd.spent = currentSpent;
      }
    }

    console.log(
      `${DHAMPIR_MODULE_ID} | Для ${actor.name} заблокировано восстановление костей хитов`,
      {
        itemUpdates
      }
    );
  } catch (error) {
    /*
     * Ошибка остаётся только в консоли и не создаёт
     * раздражающее уведомление игроку.
     */
    console.error(
      `${DHAMPIR_MODULE_ID} | Ошибка обработки костей хитов`,
      error
    );
  }
});