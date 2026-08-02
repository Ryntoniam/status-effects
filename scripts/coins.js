
// МОНЕТЫ СТРАШНО

/* ============================================================
 * ULTRAKILL COIN RICOCHET
 * Модуль: status-effects
 *
 * Требования:
 * - MidiQOL
 * - Sequencer
 * - D&D5e
 *
 * Монетка определяется:
 * 1. По флагу flags.status-effects.isCoin
 * 2. Либо по имени актёра/токена "Монетка"
 * ============================================================ */

const MODULE_ID = "status-effects";

const COIN_CONFIG = {
  coinActorName: "Монетка",

  // Дальность каждого отдельного рикошета
  range: 30,

  // Защита от чрезмерно длинных и зацикленных цепочек
  maxRicochets: 12,

  // true — удалить использованные монетки
  // false — оставить их полупрозрачными и пометить использованными
  deleteUsedCoins: true,

  // Подробные сообщения в консоли
  debug: false,

  animation: {
    enabled: true,

    // Простые стандартные изображения Foundry.
    // Позже можно заменить на JB2A.
    projectile: "jb2a.bullet.Snipe.red",
    impact: "jb2a.impact.004.dark_red",

    projectileDuration: 180,
    impactDuration: 1167
  }
};


/* ============================================================
 * РЕГИСТРАЦИЯ HOOK
 * ============================================================ */

console.log(`${MODULE_ID} | Файл рикошетов монетки загружен`, {
  user: game.user?.name,
  isGM: game.user?.isGM
});

// Убираем старый hook, если скрипт каким-либо образом загрузился повторно.
if (globalThis.statusEffectsCoinHookId) {
  Hooks.off(
    "midi-qol.RollComplete",
    globalThis.statusEffectsCoinHookId
  );
}

globalThis.statusEffectsCoinProcessedWorkflows ??= new Set();

globalThis.statusEffectsCoinHookId = Hooks.on(
  "midi-qol.RollComplete",
  async workflow => {
    try {
      await handleCoinRicochet(workflow);
    } catch (error) {
      console.error(
        `${MODULE_ID} | Критическая ошибка рикошета`,
        error,
        workflow
      );

      ui.notifications.error(
        "Произошла ошибка рикошета монетки. Подробности находятся в консоли."
      );
    }
  }
);

console.log(
  `${MODULE_ID} | Hook midi-qol.RollComplete зарегистрирован`,
  globalThis.statusEffectsCoinHookId
);


/* ============================================================
 * ГЛАВНАЯ ФУНКЦИЯ
 * ============================================================ */

async function handleCoinRicochet(workflow) {
  debugGroup("Получен midi-qol.RollComplete");

  debugLog("Workflow:", workflow);

  if (!workflow) {
    return debugStop("workflow отсутствует");
  }

  const hasAttackRoll =
    Boolean(workflow.attackRoll) ||
    Boolean(workflow.attackRolls?.length);

  if (!hasAttackRoll) {
    return debugStop("у workflow нет броска атаки");
  }

  const rangedData = getRangedAttackData(workflow);

  debugLog("Определение типа атаки:", rangedData);

  if (!rangedData.isRanged) {
    return debugStop("атака не распознана как дистанционная");
  }

  const attackerToken = asToken(workflow.token);
  const attackerActor = workflow.actor;

  if (!attackerToken) {
    return debugStop("не удалось получить токен стрелка");
  }

  if (!attackerActor) {
    return debugStop("не удалось получить актёра стрелка");
  }

  debugLog("Стрелок:", {
    token: attackerToken.name,
    actor: attackerActor.name,
    disposition: attackerToken.document.disposition
  });

  const rawHitTargets = Array.from(workflow.hitTargets ?? []);

  debugLog(
    "Исходные hitTargets:",
    rawHitTargets.map(target => target?.name ?? target)
  );

  const hitTargets = rawHitTargets
    .map(asToken)
    .filter(Boolean);

  debugLog(
    "Преобразованные hitTargets:",
    hitTargets.map(target => ({
      name: target.name,
      actorName: target.actor?.name,
      isCoin: isCoinToken(target),
      used: isCoinUsed(target)
    }))
  );

  const hitCoin = hitTargets.find(isUsableCoinToken);

  if (!hitCoin) {
    return debugStop("среди попавших целей нет доступной монетки");
  }

  debugLog("Найдена монетка:", hitCoin.name);

  /*
   * Не даём одному workflow сработать повторно.
   */
  const workflowKey =
    workflow.id ??
    workflow._id ??
    workflow.itemCardUuid ??
    workflow.itemCardId ??
    `${attackerToken.id}-${workflow.item?.id}-${Date.now()}`;

  const processed = globalThis.statusEffectsCoinProcessedWorkflows;

  if (processed.has(workflowKey)) {
    return debugStop("этот workflow уже был обработан");
  }

  processed.add(workflowKey);

  // Через минуту разрешаем удалить запись, чтобы Set не рос бесконечно.
  setTimeout(() => processed.delete(workflowKey), 60000);

  /*
   * Получаем базовые кости именно из указанного пользователем пути:
   *
   * workflow.item.system.damage.base.number
   * workflow.item.system.damage.base.denomination
   */
  const baseDamageParts = getBaseDamageDice(workflow);

debugLog(
  "Базовые части урона активности:",
  baseDamageParts
);

if (!baseDamageParts.length) {
  ui.notifications.warn(
    "Рикошет: у используемой активности нет базовых костей урона."
  );

  return debugStop(
    "в workflow.activity.damage.parts нет подходящих damage parts"
  );
}

const fallbackDamageType =
  baseDamageParts[0]?.type ??
  workflow.defaultDamageType ??
  "none";

const originalDamageDetails = getOriginalDamageDetails(
  workflow,
  fallbackDamageType
);

  debugLog("Исходные части урона:", originalDamageDetails);

  if (!originalDamageDetails.length) {
    ui.notifications.warn(
      "Рикошет: атака попала по монетке, но у неё нет рассчитанного урона."
    );

    return debugStop("не найден исходный урон workflow");
  }

  /*
   * Строим цепочку:
   * монетка → монетка → монетка → ближайший враг стрелка.
   */
  const chain = buildRicochetChain({
    startCoin: hitCoin,
    attackerToken
  });

  debugLog("Построенная цепочка:", {
    coins: chain.usedCoins.map(coin => coin.name),
    finalTarget: chain.finalTarget?.name ?? null
  });

  if (!chain.finalTarget) {
    await playRicochetAnimation(chain.usedCoins);

    await cleanupUsedCoins(chain.usedCoins);

    await ChatMessage.create({
      content: `
        <b>${hitCoin.name}</b> звенит от попадания,
        но в пределах ${COIN_CONFIG.range} футов нет подходящей цели.
      `
    });

    debugEnd();
    return;
  }

  /*
   * За каждую использованную монетку добавляем ровно
   * базовое количество костей оружия.
   *
   * Например:
   * база 2d8
   * три монетки
   * добавка 6d8
   *
   * Исходные 2d8 + 5 + бонусы остаются один раз.
   */
const ricochetCount = chain.usedCoins.length;
const rollData = attackerActor.getRollData?.() ?? {};

const extraDamageDetails = [];
const extraRollResults = [];

for (const part of baseDamageParts) {
  const extraDiceCount =
    part.number * ricochetCount;

  const formula =
    `${extraDiceCount}d${part.denomination}`;

  const roll = await new Roll(
    formula,
    rollData
  ).evaluate();

  extraDamageDetails.push({
    type: part.type,
    damage: roll.total
  });

  extraRollResults.push({
    type: part.type,
    formula,
    total: roll.total,
    roll
  });
}

debugLog(
  "Дополнительные части урона рикошета:",
  extraDamageDetails
);

const extraFormulasText = extraRollResults
  .map(result => {
    const typeLabel =
      CONFIG.DND5E.damageTypes?.[result.type]?.label ??
      result.type;

    return `${result.formula} ${typeLabel}`;
  })
  .join(" + ");

const extraTotal = extraRollResults.reduce(
  (sum, result) => sum + result.total,
  0
);

await ChatMessage.create({
  speaker: ChatMessage.getSpeaker({
    actor: attackerActor,
    token: attackerToken.document
  }),

  content: `
    <p>
      <b>Дополнительный урон рикошетов:</b>
      ${extraFormulasText}
    </p>

    <p>
      Выпало дополнительно:
      <b>${extraTotal}</b>
    </p>
  `
});

/*
 * Исходные части урона остаются без изменений:
 * кара, скрытая атака, Hex и другие бонусы не умножаются.
 *
 * Дополнительные кости создаются отдельно для каждой
 * базовой части workflow.activity.damage.parts.
 */
const finalDamageDetails = [
  ...originalDamageDetails,
  ...extraDamageDetails
];

  const totalDamage = finalDamageDetails.reduce(
    (sum, part) => sum + Number(part.damage ?? 0),
    0
  );

  debugLog("Финальные части урона:", finalDamageDetails);
  debugLog("Финальный суммарный урон:", totalDamage);

  /*
   * Анимация начинается с первой монетки.
   * Исходный путь стрелок → первая монетка уже является
   * обычной анимацией самой атаки.
   */
  await playRicochetAnimation([
    ...chain.usedCoins,
    chain.finalTarget
  ]);

  /*
   * Наносим урон финальной цели.
   *
   * Противники монетки не имеют значения:
   * цель всегда определяется относительно того,
   * кто совершил текущий выстрел.
   */
  await MidiQOL.applyTokenDamage(
    finalDamageDetails,
    totalDamage,
    new Set([chain.finalTarget]),
    null,
    new Set(),
    {}
  );

  await cleanupUsedCoins(chain.usedCoins);

  const basePartsText = baseDamageParts
  .map(part => {
    const typeLabel =
      CONFIG.DND5E.damageTypes?.[part.type]?.label ??
      part.type;

    return `${part.number}d${part.denomination} ${typeLabel}`;
  })
  .join(" + ");

  await ChatMessage.create({
  speaker: ChatMessage.getSpeaker({
    actor: attackerActor,
    token: attackerToken.document
  }),

  content: `
    <h3>Рикошет монетки</h3>

    <p>
      <b>${attackerToken.name}</b> направляет выстрел через
      <b>${ricochetCount}</b> монет(у/ы).
    </p>

    <p>
      Финальная цель:
      <b>${chain.finalTarget.name}</b>
    </p>

    <p>
      Базовые части активности:
      <b>${basePartsText}</b>
    </p>

    <p>
      Дополнительные кости рикошетов:
      <b>${extraFormulasText}</b>
    </p>

    <p>
      Дополнительный урон:
      <b>${extraTotal}</b>
    </p>

    <p>
      Общий урон:
      <b>${totalDamage}</b>
    </p>
  `
});

  debugLog("Рикошет успешно завершён");
  debugEnd();
}


/* ============================================================
 * ПОСТРОЕНИЕ ЦЕПОЧКИ
 * ============================================================ */

function buildRicochetChain({
  startCoin,
  attackerToken
}) {
  const usedCoins = [];
  const usedCoinIds = new Set();

  let currentCoin = startCoin;
  let finalTarget = null;

  for (
    let ricochetIndex = 0;
    ricochetIndex < COIN_CONFIG.maxRicochets;
    ricochetIndex++
  ) {
    if (!currentCoin) break;

    usedCoins.push(currentCoin);
    usedCoinIds.add(currentCoin.id);

    debugLog(
      `Поиск цели от монетки ${currentCoin.name}`,
      {
        ricochetIndex,
        range: COIN_CONFIG.range
      }
    );

    const nearbyTokens = findNearbyTokens(
      currentCoin,
      COIN_CONFIG.range
    );

    debugLog(
      `Цели рядом с ${currentCoin.name}:`,
      nearbyTokens.map(target => ({
        name: target.name,
        actor: target.actor?.name,
        disposition: target.document.disposition,
        isCoin: isCoinToken(target),
        usedCoin: usedCoinIds.has(target.id),
        enemyOfShooter: isEnemyOf(attackerToken, target)
      }))
    );

    /*
     * Сначала ищем другую неиспользованную монетку.
     * Disposition монетки не имеет значения.
     */
    const nearbyCoins = nearbyTokens.filter(target => {
      if (!isUsableCoinToken(target)) return false;
      if (usedCoinIds.has(target.id)) return false;

      return true;
    });

    const nextCoin = getNearestToken(
      currentCoin,
      nearbyCoins
    );

    if (nextCoin) {
      debugLog(
        `Следующая монетка: ${nextCoin.name}`
      );

      currentCoin = nextCoin;
      continue;
    }

    /*
     * Монеток больше нет.
     * Ищем ближайшего врага именно стрелка.
     */
    const enemies = nearbyTokens.filter(target => {
      if (target.id === attackerToken.id) return false;
      if (isCoinToken(target)) return false;
      if (!isEnemyOf(attackerToken, target)) return false;
      if (isDefeatedOrDead(target)) return false;

      return true;
    });

    finalTarget = getNearestToken(
      currentCoin,
      enemies
    );

    debugLog(
      "Найденная финальная цель:",
      finalTarget?.name ?? null
    );

    break;
  }

  return {
    usedCoins,
    finalTarget
  };
}


/* ============================================================
 * ПОИСК ЦЕЛЕЙ
 * ============================================================ */

function findNearbyTokens(originToken, range) {
  let nearby = [];

  /*
   * В разных версиях MidiQOL для всех dispositions
   * могли приниматься null либо "all".
   */
  try {
    nearby = MidiQOL.findNearby(
      null,
      originToken,
      range,
      {
        includeToken: false,

        // Монетка может иметь 0 HP или состояние,
        // поэтому сначала не исключаем incapacitated.
        includeIncapacitated: true
      }
    ) ?? [];
  } catch (firstError) {
    debugLog(
      "findNearby(null) не сработал, пробуем findNearby('all')",
      firstError
    );

    try {
      nearby = MidiQOL.findNearby(
        "all",
        originToken,
        range,
        {
          includeToken: false,
          includeIncapacitated: true
        }
      ) ?? [];
    } catch (secondError) {
      console.error(
        `${MODULE_ID} | MidiQOL.findNearby не сработал`,
        secondError
      );

      return [];
    }
  }

  return nearby
    .map(asToken)
    .filter(Boolean)
    .filter(target => target.id !== originToken.id)

    // Пуля не может пройти через стену.
    .filter(target => hasLineOfSight(
      originToken,
      target
    ));
}


/* ============================================================
 * ПРОВЕРКА СТЕН
 * ============================================================ */

function hasLineOfSight(fromToken, toToken) {
  try {
    const backend =
      CONFIG.Canvas?.polygonBackends?.sight;

    if (!backend?.testCollision) {
      console.warn(
        `${MODULE_ID} | Не найден sight polygon backend`
      );

      return true;
    }

    const collision = backend.testCollision(
      fromToken.center,
      toToken.center,
      {
        type: "sight",
        mode: "any"
      }
    );

    return !collision;
  } catch (error) {
    console.warn(
      `${MODULE_ID} | Ошибка проверки стены`,
      {
        from: fromToken.name,
        to: toToken.name,
        error
      }
    );

    /*
     * При ошибке не блокируем механику полностью,
     * но пишем предупреждение.
     */
    return true;
  }
}


/* ============================================================
 * БАЗОВЫЕ КОСТИ ОРУЖИЯ
 * ============================================================ */

function getBaseDamageDice(workflow) {
  const parts = workflow.activity?.damage?.parts;

  if (!parts) return [];

  let rawParts = [];

  if (Array.isArray(parts)) {
    rawParts = parts;
  } else if (typeof parts.values === "function") {
    rawParts = Array.from(parts.values());
  } else if (typeof parts === "object") {
    rawParts = Object.values(parts);
  }

  return rawParts
    .map((part, index) => {
      const number = Number(part?.number ?? 0);

      const denomination = Number(
        String(part?.denomination ?? "")
          .replace(/^d/i, "")
      );

      if (
        !Number.isFinite(number) ||
        number <= 0 ||
        !Number.isFinite(denomination) ||
        denomination <= 0
      ) {
        debugLog(
          `Часть урона №${index} пропущена: нет корректных костей`,
          part
        );

        return null;
      }

      const types = normalizeDamageTypes(
        part?.types ??
        part?.type ??
        part?.damageType
      );

      /*
       * Обычно у одной damage part один тип.
       * Если типов несколько, берём первый:
       * нельзя продублировать один бросок для каждого типа,
       * иначе урон фактически умножится.
       */
      const type =
        types[0] ??
        workflow.defaultDamageType ??
        "none";

      if (types.length > 1) {
        console.warn(
          `${MODULE_ID} | У части урона несколько типов. ` +
          `Для рикошета выбран первый: ${type}`,
          {
            part,
            types
          }
        );
      }

      return {
        index,
        number,
        denomination,
        types,
        type,
        formula: `${number}d${denomination}`,
        originalPart: part
      };
    })
    .filter(Boolean);
}


function normalizeDamageTypes(value) {
  if (!value) return [];

  if (typeof value === "string") {
    return value ? [value] : [];
  }

  if (value instanceof Set) {
    return Array.from(value).filter(Boolean);
  }

  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([type]) => type);
  }

  return [];
}


/* ============================================================
 * ТИП БАЗОВОГО УРОНА
 * ============================================================ */

function getBaseDamageType(workflow) {
  const base =
    workflow.item?.system?.damage?.base;

  const possibleTypes = [
    base?.type,
    base?.damageType,
    base?.types,
    workflow.defaultDamageType
  ];

  for (const value of possibleTypes) {
    const result = extractFirstDamageType(value);

    if (result) return result;
  }

  return "piercing";
}


function extractFirstDamageType(value) {
  if (!value) return null;

  if (typeof value === "string") {
    return value || null;
  }

  if (value instanceof Set) {
    return Array.from(value)[0] ?? null;
  }

  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  if (typeof value === "object") {
    /*
     * Может встретиться объект вроде:
     * { piercing: true }
     */
    const enabledKey = Object.entries(value)
      .find(([, enabled]) => Boolean(enabled))
      ?.[0];

    return enabledKey ?? null;
  }

  return null;
}


/* ============================================================
 * ПОЛУЧЕНИЕ ИСХОДНОГО УРОНА
 * ============================================================ */

function getOriginalDamageDetails(
  workflow,
  fallbackDamageType
) {
  const rawDetails =
    workflow.damageDetail ??
    workflow.damageDetails ??
    [];

  if (Array.isArray(rawDetails) && rawDetails.length) {
    const normalized = rawDetails
      .flat(Infinity)
      .map(detail => normalizeDamageDetail(
        detail,
        fallbackDamageType
      ))
      .filter(Boolean);

    if (normalized.length) {
      return normalized;
    }
  }

  /*
   * Fallback, если damageDetail в текущей версии MidiQOL
   * отсутствует или имеет неожиданную структуру.
   */
  const damageTotal = getWorkflowDamageTotal(workflow);

  if (!Number.isFinite(damageTotal)) {
    return [];
  }

  return [
    {
      type: fallbackDamageType,
      damage: damageTotal
    }
  ];
}


function normalizeDamageDetail(
  detail,
  fallbackDamageType
) {
  if (!detail || typeof detail !== "object") {
    return null;
  }

  const damage = Number(
    detail.damage ??
    detail.value ??
    detail.total
  );

  if (!Number.isFinite(damage)) {
    return null;
  }

  const type =
    extractFirstDamageType(
      detail.type ??
      detail.damageType ??
      detail.options?.type
    ) ??
    fallbackDamageType;

  /*
   * Сохраняем дополнительные свойства damage detail,
   * если MidiQOL их использует.
   */
  return {
    ...detail,
    type,
    damage
  };
}


function getWorkflowDamageTotal(workflow) {
  const directTotal = Number(workflow.damageTotal);

  if (Number.isFinite(directTotal)) {
    return directTotal;
  }

  const rolls = [];

  if (Array.isArray(workflow.damageRolls)) {
    rolls.push(...workflow.damageRolls);
  } else if (workflow.damageRoll) {
    rolls.push(workflow.damageRoll);
  }

  if (Array.isArray(workflow.bonusDamageRolls)) {
    rolls.push(...workflow.bonusDamageRolls);
  } else if (workflow.bonusDamageRoll) {
    rolls.push(workflow.bonusDamageRoll);
  }

  const total = rolls.reduce(
    (sum, roll) => sum + Number(roll?.total ?? 0),
    0
  );

  return rolls.length ? total : NaN;
}


/* ============================================================
 * ПРОВЕРКА ДИСТАНЦИОННОЙ АТАКИ
 * ============================================================ */

function getRangedAttackData(workflow) {
  const actionType =
    workflow.activity?.actionType ??
    workflow.activity?.system?.actionType ??
    workflow.item?.system?.actionType ??
    null;

  const attackType =
    workflow.activity?.attack?.type?.value ??
    workflow.activity?.system?.attack?.type?.value ??
    workflow.activity?.attack?.type ??
    null;

  const itemWeaponType =
    workflow.item?.system?.type?.value ??
    null;

  const isRanged =
    actionType === "rwak" ||
    actionType === "rsak" ||
    attackType === "ranged" ||
    itemWeaponType === "ranged";

  return {
    isRanged,
    actionType,
    attackType,
    itemWeaponType
  };
}


/* ============================================================
 * МОНЕТКИ
 * ============================================================ */

function isCoinToken(token) {
  if (!token) return false;

  const flag =
    token.document.getFlag(MODULE_ID, "isCoin");

  const actorName =
    token.actor?.name;

  const tokenName =
    token.name ??
    token.document?.name;

  return (
    flag === true ||
    actorName === COIN_CONFIG.coinActorName ||
    tokenName === COIN_CONFIG.coinActorName
  );
}


function isCoinUsed(token) {
  return (
    token?.document?.getFlag(
      MODULE_ID,
      "used"
    ) === true
  );
}


function isUsableCoinToken(token) {
  return (
    isCoinToken(token) &&
    !isCoinUsed(token)
  );
}


/* ============================================================
 * ОТНОШЕНИЕ К СТРЕЛКУ
 * ============================================================ */

function isEnemyOf(sourceToken, targetToken) {
  if (!sourceToken || !targetToken) return false;

  const sourceDisposition =
    sourceToken.document.disposition;

  const targetDisposition =
    targetToken.document.disposition;

  /*
   * Нейтральные токены не считаются врагами.
   */
  if (
    targetDisposition ===
    CONST.TOKEN_DISPOSITIONS.NEUTRAL
  ) {
    return false;
  }

  /*
   * Если disposition отличается, цель считается врагом.
   *
   * Поэтому при выстреле противника монетка работает
   * в пользу противника, а не своего создателя.
   */
  return sourceDisposition !== targetDisposition;
}


/* ============================================================
 * МЁРТВЫЕ И ПОБЕЖДЁННЫЕ
 * ============================================================ */

function isDefeatedOrDead(token) {
  const hp =
    token.actor?.system?.attributes?.hp?.value;

  if (typeof hp === "number" && hp <= 0) {
    return true;
  }

  const statuses =
    token.actor?.statuses;

  if (statuses?.has?.("dead")) return true;
  if (statuses?.has?.("unconscious")) return true;

  return Boolean(
    token.combatant?.defeated
  );
}


/* ============================================================
 * БЛИЖАЙШАЯ ЦЕЛЬ
 * ============================================================ */

function getNearestToken(originToken, tokens) {
  if (!tokens?.length) return null;

  return tokens
    .map(target => ({
      target,
      distance: getTokenDistance(
        originToken,
        target
      )
    }))
    .sort((a, b) => a.distance - b.distance)
    .at(0)
    ?.target ?? null;
}


function getTokenDistance(firstToken, secondToken) {
  try {
    if (typeof MidiQOL.computeDistance === "function") {
      const midiDistance = MidiQOL.computeDistance(
        firstToken,
        secondToken,
        {
          wallsBlock: false
        }
      );

      if (Number.isFinite(midiDistance)) {
        return midiDistance;
      }
    }
  } catch (error) {
    debugLog(
      "MidiQOL.computeDistance не сработал",
      error
    );
  }

  const dx =
    firstToken.center.x -
    secondToken.center.x;

  const dy =
    firstToken.center.y -
    secondToken.center.y;

  const pixelDistance = Math.hypot(dx, dy);

  return (
    pixelDistance /
    canvas.grid.size *
    canvas.scene.grid.distance
  );
}


/* ============================================================
 * ПРЕОБРАЗОВАНИЕ TOKEN / TOKENDOCUMENT
 * ============================================================ */

function asToken(value) {
  if (!value) return null;

  /*
   * Уже Token placeable.
   */
  if (value.document?.documentName === "Token") {
    return value;
  }

  /*
   * TokenDocument.
   */
  if (value.documentName === "Token") {
    return (
      value.object ??
      canvas.tokens.get(value.id) ??
      null
    );
  }

  /*
   * Иногда объект может содержать token/document.
   */
  if (value.token?.documentName === "Token") {
    return (
      value.token.object ??
      canvas.tokens.get(value.token.id) ??
      null
    );
  }

  return null;
}


/* ============================================================
 * АНИМАЦИЯ SEQUENCER
 * ============================================================ */

async function playRicochetAnimation(points) {
  if (!COIN_CONFIG.animation.enabled) return;

  if (!game.modules.get("sequencer")?.active) {
    debugLog("Sequencer неактивен — анимация пропущена");
    return;
  }

  const validPoints = points
    .map(asToken)
    .filter(Boolean);

  if (!validPoints.length) return;

  const sequence = new Sequence({
    moduleName: MODULE_ID,
    softFail: true
  });

  /*
   * Если есть только одна монетка и нет цели,
   * показываем короткую вспышку.
   */
  if (validPoints.length === 1) {
    sequence
      .effect()
      .file(COIN_CONFIG.animation.impact)
      .atLocation(validPoints[0])
      .scale(0.35)
      .duration(
        COIN_CONFIG.animation.impactDuration
      )
      .fadeOut(150);

    await sequence.play();
    return;
  }

  for (
    let index = 0;
    index < validPoints.length - 1;
    index++
  ) {
    const from = validPoints[index];
    const to = validPoints[index + 1];

    sequence
      .effect()
      .file(COIN_CONFIG.animation.projectile)
      .atLocation(from)
      .stretchTo(to)
      .duration(
        COIN_CONFIG.animation.projectileDuration
      )
      .fadeIn(30)
      .fadeOut(80)
      .waitUntilFinished(-60)

      .effect()
      .file(COIN_CONFIG.animation.impact)
      .atLocation(to)
      .scale(0.3)
      .duration(
        COIN_CONFIG.animation.impactDuration
      )
      .fadeOut(150);
  }

  await sequence.play();
}


/* ============================================================
 * УДАЛЕНИЕ ИЛИ ПОМЕТКА МОНЕТОК
 * ============================================================ */

async function cleanupUsedCoins(coins) {
  for (const coin of coins) {
    if (!coin?.document) continue;

    try {
      if (COIN_CONFIG.deleteUsedCoins) {
        await coin.document.delete();
        continue;
      }

      await coin.document.setFlag(
        MODULE_ID,
        "used",
        true
      );

      await coin.document.update({
        alpha: 0.35
      });
    } catch (error) {
      console.error(
        `${MODULE_ID} | Не удалось удалить или пометить монетку`,
        {
          coin: coin.name,
          error
        }
      );

      /*
       * Пробуем хотя бы поставить флаг.
       */
      try {
        await coin.document.setFlag(
          MODULE_ID,
          "used",
          true
        );
      } catch (flagError) {
        console.error(
          `${MODULE_ID} | Не удалось поставить флаг used`,
          flagError
        );
      }
    }
  }
}


/* ============================================================
 * ДИАГНОСТИКА
 * ============================================================ */

function debugGroup(label) {
  if (!COIN_CONFIG.debug) return;

  console.groupCollapsed(
    `${MODULE_ID} | ${label}`
  );
}


function debugLog(...args) {
  if (!COIN_CONFIG.debug) return;

  console.log(
    `${MODULE_ID} |`,
    ...args
  );
}


function debugStop(reason) {
  if (COIN_CONFIG.debug) {
    console.log(
      `${MODULE_ID} | STOP: ${reason}`
    );

    console.groupEnd();
  }
}


function debugEnd() {
  if (!COIN_CONFIG.debug) return;

  console.groupEnd();
}