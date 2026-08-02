export const Constants = {
    ID: "status-effects"
}

export async function updateEffect(effect, updates) {
    updates._id = effect.id
    await MidiQOL.updateEffects({actorUuid: effect.parent.uuid, updates: [updates]})
}

export async function createEffect(actor, effectData) {
    await MidiQOL.createEffects({actorUuid: actor.uuid, effects: [effectData]})
}

export async function burnDamage(target, stacks) {
    const roll = await new Roll(`${stacks}`).evaluate();
    await roll.toMessage({flavor: `Огонь, урон - [${roll.total}]`});
    await MidiQOL.applyTokenDamage(
        [
            {
                type: "fire", 
                damage: roll.total
            }
        ], 
        roll.total,
        new Set([target]), 
        null, 
        new Set(), 
        {}
    )
}

export async function bleedDamage(target, stacks) {
    const roll = await new Roll(`${stacks}`).evaluate();
    await roll.toMessage({flavor: `Кровотечение, урон - [${roll.total}]`});
    await MidiQOL.applyTokenDamage(
        [
            {
                type: "none", 
                damage: roll.total
            }
        ], 
        roll.total,
        new Set([target]), 
        null, 
        new Set(), 
        {}
    )
}

// Я отвергаю свою человечность
export const mactoTemplate = `/* НАСТРОЙКА ЭФФЕКТА */

// Опции попадания
const targetOptions = {
    getHit: true, // Эффект применяется при попадании
    failSave: true, // Эффект применяется при провале спасброска
    halfOnSave: false, // При успешном спасброске кол-во стаков эффекта делится на 2
    anyCase: false // Эффект применяется в любом случае
}

// Данные эффекта
const _effectName = \`НАЗВАНИЕ_ЭФФЕКТА\`
const _icon = "icons/svg/acid.svg"
let _effectStacks = 1
// Если макросу был передан аргумент - в качестве КОЛИЧЕСТВА СТАКОВ будет принят аргумент

if (typeof args !== 'undefined' && args[0]?.count) {
    _effectStacks = args[0].count
}

// Доп условия срабатывания эффекта
const effectConditions = (target) => {
    // По умолчанию возвращает true - в этом случае эффект применится
    return true
}

// Если режим и значение для всех ключей не отличаются - рекомендуется использовать getChanges
const getChanges = (keys, eStack) => keys.map(k => ({key: k, mode: "2", value: eStack * 1}))

// Механика эффекта
const effectData = (effectName, effectStacks) => { return {
    'label': \`\${effectName} - \${effectStacks}\`,
    'icon': _icon,
    /*
    'duration': {
        'seconds': 60
    },
    'changes': [

    ],
    */
    'flags': {
        'core': {
            'statusId': "1"
        }
    }
}}

const updates = (effectName, effectStacks) => {return {
    'label': \`\${effectName} - \${effectStacks}\`,
    /*
    'changes': [

    ]
    */
}}

// Дополнительные аудио-визуальные эффекты
function extraEffects() {
    /*
    new Sequence()
        .sound()
            .file("attackSound/effects/EFFECT_SOUND.wav")
            .volume(0.25)
        .play()
    */
}

/* РАБОЧАЯ ЧАСТЬ */

let targets = []
if (typeof workflow !== 'undefined') {
    if (workflow.hitTargets.size > 0 && targetOptions.getHit && (workflow.attackRoll || targetOptions.halfOnSave)) {
        workflow.hitTargets.forEach(t => {
            if (!targets.some(tar => tar.tokenId === t.id)) {
                targets.push({
                    tokenId: t.id,
                    token: t,
                    mod: targetOptions.halfOnSave ? 0.5 : 1
                })
            }
        })
    }
    
    if (workflow.failedSaves.size > 0 && targetOptions.failSave) {
        workflow.failedSaves.forEach(t => {
            if (!targets.some(tar => tar.tokenId === t.id)) {
                targets.push({
                    tokenId: t.id,
                    token: t,
                    mod: 1
                })
            } else if (targetOptions.halfOnSave) {
                targets.find(tar => tar.tokenId === t.id).mod = 1
            }
        })
    }
    
    if (workflow.targets.size > 0 && targetOptions.anyCase) {
        workflow.targets.forEach(t => {
            if (!targets.some(tar => tar.tokenId === t.id)) {
                targets.push({
                    tokenId: t.id,
                    token: t,
                    mod: 1
                })
            }
        })
    }
} else if (typeof args !== 'undefined' && args[0]?.targets) {
    targets = args[0].targets
} else {
    targets = Array.from(game.user.targets).map(t => ({tokenId: t.id, token: t, mod: 1}))
}

for (let target of targets) {
    if (effectConditions(target)) {
        await effectMagic(target, _effectName, Math.floor(_effectStacks * target.mod));
    }
}
async function effectMagic (target, effectName, effectStacks) {
    const pattern = new RegExp(\`\${effectName} - ([0-9]+)$\`);
    const effect = target.token.actor.appliedEffects.find(eff => pattern.test(eff?.name));
    if (!effect) {
        await createEffect(target.token.actor, effectData(effectName, effectStacks));
    } else {
        effectStacks += parseInt(effect.label.match(/\\d+/)[0])
        await updateEffect(effect, updates(effectName, effectStacks));
        new Sequence()
            .scrollingText(target.token, \`\${effectName} - \${effectStacks}\`)   
            .play() 
    }
    extraEffects()
}

/* ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ */

async function updateEffect(effect, updates) {
    if (game.user.isGM) {
        await effect.update(updates);
    } else {
        updates._id = effect.id;
        await MidiQOL.socket().executeAsGM('updateEffects', {'actorUuid': effect.parent.uuid, 'updates': [updates]});
    }
}

async function createEffect(actor, effectData) {
    if (isNewerVersion(game.version, '11.293') && effectData.label) {
        effectData.name = effectData.label;
        delete effectData.label;
    }
    if (game.user.isGM) {
        await actor.createEmbeddedDocuments('ActiveEffect', [effectData]);
    } else {
        await MidiQOL.socket().executeAsGM('createEffects', {'actorUuid': actor.uuid, 'effects': [effectData]});
    }
}`