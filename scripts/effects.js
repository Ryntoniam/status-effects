import { Constants as C, updateEffect, createEffect, burnDamage, bleedDamage } from "./const.js";

//Пойз - снижение стаков после крита
Hooks.on("midi-qol.AttackRollComplete", async (workflow) => {
    if (workflow.hitTargets.size == 0) return
    const effect = workflow.actor?.appliedEffects?.find(eff => /Пойз - [0-9]+$/.test(eff.name))
    if (!effect) return
    if (!workflow.critFlagSet) return
    const effectStacks = Math.floor(parseInt(effect.name.match(/\d+/)[0]) - 10)
    let crit = []
    if (effectStacks > 0) {
            if (effectStacks >= 10) crit = [{key: 'flags.midi-qol.critical.all', value: '1', mode: 5, priority: 20}]
            await updateEffect(effect, {'name': `Пойз - ${effectStacks}`, 'changes': crit})
            new Sequence()
                .scrollingText(workflow.token, `Паралич - ${effectStacks}`)   
                .play() 
        } else {
            await effect.delete()
        }
    c
})

// Паралич - уменьшение кол-ва стаков после атаки
Hooks.on("midi-qol.AttackRollComplete", async (workflow) => {
    if (workflow.targets.size == 0) return
    const effect = workflow.actor?.appliedEffects?.find(eff => /Паралич - [0-9]+$/.test(eff.name))
    if (!effect) return
        const effectStacks = Math.floor(parseInt(effect.name.match(/\d+/)[0]) / 2)
        if (effectStacks > 0) {
            await updateEffect(effect, {'name': `Паралич - ${effectStacks}`, 'changes': [{'key': 'system.bonuses.All-Attacks', 'mode': 2, 'value': -effectStacks, 'priority': 20}]})
            new Sequence()
                .scrollingText(workflow.token, `Паралич - ${effectStacks}`)   
                .play() 
        } else {
            await effect.delete()
        }
})

// Блид - прокаем при перемещении
Hooks.on("updateToken", async (token, update, changes, userId) => {
    if ((!update.x && !update.y) || changes.animate == true) return
	const actor = token.actor
    const bleed = actor.appliedEffects.find(eff => /Кровотечение - [0-9]+$/.test(eff.name))
    if (!bleed) return
    /*
    const _x = update.x ? update.x - changes["chris-premades"].coords.previous.x : 0
    const _y = update.y ? update.y - changes["chris-premades"].coords.previous.y : 0
    const maxDistance = Math.floor(Math.max(Math.abs(_x), Math.abs(_y)) / canvas.scene.grid.size * canvas.scene.grid.distance)
    const pathTraveled = (actor.getFlag("status-effects", "pathTraveled") || 0) + maxDistance
    const procAmount = Math.floor(pathTraveled / 15)
    */
    let pathTraveled = changes._movement[token._id].passed.spaces + actor.getFlag("status-effects", "pathTraveled")
	let stacks = parseInt(bleed.name.match(/\d+/)[0])
        while (pathTraveled >= 3) {
            await bleedDamage(token.object, stacks)
            stacks = Math.floor(stacks / 2)
            pathTraveled = pathTraveled - 3
            await updateEffect(bleed, {'name': `Кровотечение - ${stacks}`})
            if (stacks <= 0) break
        }
    if (stacks > 0) {
        await actor.setFlag("status-effects", "pathTraveled", (pathTraveled))
    } else {
        await bleed.delete()
        await actor.unsetFlag("status-effects", "pathTraveled")
    }

})

// Блид - прокаем при успешной атаке
Hooks.on("midi-qol.AttackRollComplete", async (workflow) => {
    if (workflow.hitTargets.size == 0) return 
	//if (workflow.targets.size === 0) return - при любой атаке
    const bleed = workflow.actor.appliedEffects.find(eff => /Кровотечение - [0-9]+$/.test(eff.name))
    if (!bleed) return
    const stacks = parseInt(bleed.name.match(/\d+/)[0])
    await bleedDamage(workflow.token, stacks)
    const newStacks = Math.floor(stacks / 2)
    if (newStacks > 0) {
        await updateEffect(bleed, {'name': `Кровотечение - ${newStacks}`,})
    } else {
        await bleed.delete()
        await actor.unsetFlag("status-effects", "pathTraveled")
    }
})

// Блид - снижаем кол-во стаков в два раза при хиле
Hooks.on("dnd5e.healActor", async (actor, amount) => {
    if (amount.hp < 3) return
    const effect = actor.appliedEffects.find(eff => /Кровотечение - [0-9]+$/.test(eff.name))
    if (!effect) return
    const stacks = Math.floor(parseInt(effect.name.match(/\d+/)[0]) / 2)
    if (stacks > 0) {
        await updateEffect(effect, {'name': `Кровотечение - ${stacks}`,})
    } else {
        await effect.delete()
        await actor.unsetFlag("status-effects", "pathTraveled")
    }
})

// Бёрн - урон
Hooks.on('combatRound', async (combat) => {
    const targets = combat.combatants.contents
    if (targets.length === 0) return
    targets.forEach(async target => {
        const flame = target.actor?.appliedEffects?.find(eff => /Горение - [0-9]+$/.test(eff.name))
        const darkFlame = target.actor?.appliedEffects?.find(eff => /Темное пламя - [0-9]+$/.test(eff.name))
        if (darkFlame) {
            const stacks = parseInt(darkFlame.name.match(/\d+/)[0])
            await burnDamage(target.token._object, stacks)
            const newStacks = Math.floor(stacks / 2)
            if (newStacks > 0) {
                await updateEffect(darkFlame, {'name': `Темное пламя - ${newStacks}`,})
            } else {
                await darkFlame.delete()
            }
        }
        if (flame) {
            const stacks = parseInt(flame.name.match(/\d+/)[0])
            await burnDamage(target.token._object, stacks)
            new Sequence()
                .effect()
                    .file('modules/jb2a_patreon/Library/Generic/Cast/CastFire01_01_Regular_Orange_600x600.webm')
                    .atLocation(target.token._object)
                .play()
            const newStacks = Math.floor(stacks / 2)
            if (newStacks > 0) {
                await updateEffect(flame, {'name': `Горение - ${newStacks}`,})
            } else {
                await flame.delete()
            }
        }
    })
})

// ЭГО Суды - доп бёрн с атак
Hooks.on("midi-qol.AttackRollComplete", async (workflow) => {
    if (workflow.hitTargets.size === 0) return
	//if (workflow.targets.size === 0) return - при любой атаке
    const burned = workflow.actor.appliedEffects.find(eff => eff.name === 'Инстинкт саморазрушения')
    if (!burned || (workflow.item.system.type.value !== ("simpleM"||"martialM"))) return
    
    const target = workflow.hitTargets.first()
    let effectStacks = 1
    if (workflow.actor.system.attributes.hp.value < workflow.actor.system.attributes.hp.max/2) effectStacks = 3
    const effectData = (effectName, effectStacks) => { return {
        'name': `${effectName} - ${effectStacks}`,
        'img': "modules/status-effects/icons/dark_flame.webp",
        /*
        'duration': {
            'seconds': 60
        },
        */
        'flags': {
        'dae': {
            'showIcon': true
        }
        },
        'changes': []
    }}
    
    const updates = (effectName, effectStacks) => {return {
        'name': `${effectName} - ${effectStacks}`,
        'changes': []
    }}
    const effName = 'Темное пламя'
    const effect = target.actor.appliedEffects.find(eff => /Темное пламя - [0-9]+$/.test(eff.name))
    if (!effect) {
        await createEffect(target.actor, effectData(effName, effectStacks));
    } else {
        effectStacks += parseInt(effect.name.split(" - ")[1])
        await updateEffect(effect, updates(`Темное пламя`, effectStacks));
        new Sequence()
            .scrollingText(target, `Темное пламя - ${effectStacks}`)   
            .play() 
    }
})