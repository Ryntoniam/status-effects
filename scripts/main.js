import { Constants as C, mactoTemplate } from "./const.js";

// Добавление кнопки создания статус-эффекта в предметы
Hooks.on("getItemSheetHeaderButtons", (app, buttons) => {
    buttons.unshift({
        class: "status-effects",
        icon: "fas fa-fire",
        onclick: () => {new StatusEffectsApp(app.object.uuid).render(true)}
    });
})

export class StatusEffectsApp extends FormApplication {
    constructor(itemUuid = null) {
        super();
        this.itemUuid = itemUuid
    }
    
    static get defaultOptions() {
        const defaults = super.defaultOptions;

        const overrides = {
            width: 540,
            height: 450,
            resizable: true,
            id: `status-effects-${this.itemUuid}`,
            template: `modules/${C.ID}/templates/effectApp.hbs`,
            title: `Status Effects`,
            userId: game.userId,
            closeOnSubmit: false,
            submitOnChange: false,
            dragDrop: [
                {
                    dragSelector: '.sea-effects-list',
                },
            ]
        };
        const mergedOptions = foundry.utils.mergeObject(defaults, overrides);
        return mergedOptions;
    }

    getData(options) {
        const item = fromUuidSync(this.itemUuid);
        const statusEffectsIds = item.getFlag(C.ID, "statusEffectsIds") || [];
        const statusEffects = statusEffectsIds.map(id => {
            const effectMacro = game.macros.get(id);
            const hasSecArg = effectMacro.command.includes("_effectLimit") || effectMacro.command.includes("_effectPower");
            return {
                id: effectMacro.id,
                name: effectMacro.name,
                img: effectMacro.img,
                stacks: "1" + (hasSecArg ? " / 1" : "")
            }
        })
        return { effects: statusEffects };
    }

    activateListeners(html) {
        super.activateListeners(html);
        const item = fromUuidSync(this.itemUuid);
        
        // Открыть окно макросов
        html.find('.sea-open-macros-button').click(() => {
            const folderId = game.settings.get("status-effects", "macroFolderId");
            if (!folderId) {
                // Нужно открыть окошко, мол, "ебани сюда ID папки пжпж"
                ui.notifications.error(`Macro folder id not set! >:(`)
                return
            }
            game.folders._expanded[`Folder.${folderId}`] = true;
            ui.macros.renderPopout(true)
        })

        // Создать новый эффект
        html.find('.sea-create-button').click(async () => {
            const macroData = {
                name: '!Новый пустой эффект',
                type: 'script',
                author: game.userId,
                img: 'icons/svg/acid.svg',
                scope: 'global',
                command: mactoTemplate,
                folder: game.settings.get("status-effects", "macroFolderId"),
            }
            const newMacro = await Macro.create(macroData)
            ui.notifications.info(`Макрос создан!`)

            // Добавляем его в список макросов в окне
            const listEl = html.find('.sea-effects-list')
            const newEffectEl = createNewListItemEl(newMacro)
            listEl.append(newEffectEl)
        })

        // Очистить эффекты
        html.find('.sea-clear-button').click(async () => {
            html.find('.sea-effects-list').innerHTML = ''
            await item.setFlag(C.ID, "statusEffectsIds", [])
            ui.notifications.info(`Эффекты очищены!`)
        })

        // Открыть окно макроса эффекта
        html[0].querySelectorAll('.sea-effect-macro').forEach(el => {
            el.addEventListener('click', openEffectMacro.bind(null, el.parentElement.parentElement.dataset.effectId))
        })

        // Удалить эффект
        html[0].querySelectorAll('.sea-effect-delete').forEach(el => {
            el.addEventListener('click', deleteEffectMacro.bind(null, el.parentElement.parentElement))
        })

        // Применить изменения
        html[0].querySelector('.sea-apply-button').addEventListener('click', async () => {
            // Флаг
            const effectEls = html.find('.sea-effects-list')[0].querySelectorAll('.sea-effect-item')
            const newEffectList = Array.from(effectEls)?.map(el => el?.dataset?.effectId) || []
            await item.setFlag(C.ID, "statusEffectsIds", newEffectList)
            // Включаем macroOnUse если нужно
            const onUseMacroName = item.getFlag("midi-qol", "onUseMacroName")
            if (!onUseMacroName.includes("]ItemMacro")) {
                await item.setFlag("midi-qol", "onUseMacroName", `${onUseMacroName},[postActiveEffects]ItemMacro`)
                let macroParts = item.getFlag("midi-qol", "onUseMacroParts")
                macroParts.items.push({"macroName": "ItemMacro","option": "postActiveEffects"})
                await item.setFlag("midi-qol", "onUseMacroParts", macroParts)
            }
            // Изменяем ItemMacro предмета



            ui.notifications.info(`Изменения применены!`)
            this.close()
        })
    }

    async _onDrop(event) {
        const data = event.dataTransfer.getData('text/plain');
        if (!data || data === "") return
        const transferData = JSON.parse(data)
        if (transferData?.type !== "Macro") return
        const effectMacro = fromUuidSync(transferData?.uuid)
        if (!effectMacro) {
            ui.notifications.error(`Макрос эффекта не найден!`)
            return
        }
        const html = this._element
        const listEl = html.find('.sea-effects-list')
        const newEffectEl = createNewListItemEl(effectMacro)
        listEl.append(newEffectEl)
    }

    async _updateObject(event, formData) {
    }
}

const createNewListItemEl = (newMacro) => {
    const newEffectEl = document.createElement('li')
    newEffectEl.classList.add('sea-effect-item', 'flexrow')
    newEffectEl.dataset.effectId = newMacro.id
    newEffectEl.innerHTML = `
        <div class="sea-effect-icon flex0"><img src="${newMacro.img}"></div>
        <div class="sea-effect-name flex1">${newMacro.name}</div>
        <div class="sea-effect-buttons flex0">
            <div class="sea-effect-macro" data-tooltip="${game.i18n.localize('status-effects.macroTooltip')}"><i class="fas fa-pencil"></i></div>
            <div class="sea-effect-delete" data-tooltip="${game.i18n.localize('status-effects.deleteTooltip')}"><i class="fas fa-times"></i></div>
        </div>
    `
    newEffectEl.querySelector('.sea-effect-macro').addEventListener('click', openEffectMacro.bind(null, newMacro.id))
    newEffectEl.querySelector('.sea-effect-delete').addEventListener('click', deleteEffectMacro.bind(null, newMacro.id, newEffectEl))

    return newEffectEl
}
const openEffectMacro = (id) => {
    const effectMacro = game.macros.get(id)
    if (effectMacro) {
        effectMacro.sheet.render(true)
    } else {
        ui.notifications.error(`Макрос эффекта не найден!`)
    }
}
const deleteEffectMacro = async (newEffectEl) => {
    newEffectEl.remove()
}
Hooks.on("preUpdateActor", async function(actor, update, options, userId) {
    const isHealth = hasProperty(update, "system.attributes.hp.value");
    if (!isHealth) return;
    if (actor.system.attributes.hp.value < 1 || update.system.attributes.hp.value > 0) return
    const hasImmortal = actor.items.find(item => (item.system.source.custom === "Бессмертие"))
    if (!hasImmortal) return;
    foundry.utils.setProperty(update, "system.attributes.hp.value", 1);
    
    foundry.utils.setProperty(options, "zdohId", hasImmortal.id);
});

Hooks.on("updateActor", async function(actor, update, options, userId) {
    if (options.zdohId) {
        const saveEffects = actor.appliedEffects.find(eff => /Жижность - [0-9]+$/.test(eff.label)) 
        const savePenalty = parseInt(saveEffects?.label?.split(" - ")[1] || 0)
        const saveBonus = actor.system.abilities.con.save
        const roll = await new Roll(`d20 + ${saveBonus} - ${savePenalty}`).evaluate();
        const success = roll.total >= 1
        await MidiQOL.applyTokenDamage(
            [
                {
                    type: "healing", 
                    damage: 1
                }
            ], 
            1,
            new Set([actor]), 
            null, 
            new Set(), 
            {}
        )
        await roll.toMessage({flavor: `Спасбросок от ТОГО ЧТОб СДОХНУТЬ - ${success ? "Успех!" : "Провал БЛЯЯЯ"}`}); 
        if (success) {
            if (saveEffects) {
                await updateEffect(saveEffects, {'label': `Жижность - ${savePenalty + 1}`});
            } else {
                await createEffect(actor, {
                    'label': `Жижность - 1`,
                    'icon': 'icons/svg/blood.svg',
                    'flags': {
                        'core': {
                            'statusId': "1"
                        }
                    },
                })
            }
        } else  {
            if (saveEffects) await saveEffects.delete();
            await actor.items.delete(options.zdohId)
            await actor.update({"system.attributes.hp.value": 0})
        }
    }
});

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
}

/*async function createEffect(actor, effectData) {
    if (game.user.isGM) {
        await actor.createEmbeddedDocuments('ActiveEffect', [effectData]);
    } else {
        await MidiQOL.socket().executeAsGM('createEffects', {'actorUuid': actor.uuid, 'effects': [effectData]});
    }
}*/