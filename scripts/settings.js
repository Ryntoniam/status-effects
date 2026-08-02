import { Constants as C } from "./const.js";

Hooks.on("init", () => {
    const registerSettings = (key, _scope = 'world', _config = true, _type = Boolean, _default = true, change = false, choices = null) => {
        game.settings.register(C.ID, key, {
            ...{
                name: game.i18n.localize(`${C.ID}.settings.${key}`),
                hint: game.i18n.localize(`${C.ID}.settings.${key}Hint`),
                scope: _scope,
                config: _config,
                type: _type,
                default: _default,
                onChange: (value) => {/*
                    if (!change || !game.settings.get("transferOnChange")) {
                        return
                    } else if (change == "macro") {

                    } else if (change == "item") {

                    } else {
                        // бля потом
                    }*/
                }
            }, 
            ...(choices ? { choices: choices[1] } : {})
        });
    }

    // Перемещать штуки при изменении
    registerSettings("transferOnChange", "world", false, Boolean, true)
    // ID папки для макросов эффектов
    registerSettings("macroFolderId", "world", true, String, "", "macro")
    // ID папки для предметов-эффектов
    registerSettings("itemFolderId", "world", true, String, "", "item")
    // ID журнала для эффектов
    registerSettings("journalFolderId", "world", true, String, "", "journal")
    // Выбор где описывать статусы (предметы/журнал/оба)
    registerSettings("effectLocation", "world", true, String, "item", "location", {"Предметы": "item", "Журнал": "journal", "Оба": "both"})
})