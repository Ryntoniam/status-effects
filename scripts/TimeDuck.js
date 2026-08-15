Hooks.on("combatTurnChange", async (combat, prior, current) => {

    // Hook срабатывает на всех клиентах.
    // Сохранять snapshot должен только один GM.
    if (game.users.activeGM?.id !== game.user.id) return;

    const combatant = combat.combatant;
    if (!combatant) return;

    const actor = combatant.actor;
    const token = combatant.token;

    if (!actor || !token) return;

    // Отслеживаем только Actor с включённой способностью.
    const enabled = actor.getFlag("world", "timeRewindEnabled");

    if (!enabled) return;

    const snapshot = {
        timestamp: Date.now(),

        combat: {
            round: combat.round,
            turn: combat.turn,
            combatantId: combatant.id
        },

        actor: {
            system: foundry.utils.deepClone(actor.toObject().system),

            items: actor.items.map(item => item.toObject()),

            effects: actor.effects.map(effect => effect.toObject())
        },

        token: {
            sceneId: token.parent.id,
            tokenId: token.id,

            x: token.x,
            y: token.y,
            elevation: token.elevation,
            rotation: token.rotation,
            hidden: token.hidden
        }
    };

    const history =
        combatant.getFlag("world", "timeRewindHistory") ?? [];

    history.push(snapshot);

    // Текущее состояние + три предыдущих.
    const trimmedHistory = history.slice(-4);

    await combatant.setFlag(
        "world",
        "timeRewindHistory",
        trimmedHistory
    );

    console.log(
        `Time Rewind | Snapshot сохранён для ${actor.name}`,
        snapshot,
        trimmedHistory
    );
});