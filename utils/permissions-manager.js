const { BAN_ROLES, SUSPECT_ROLES, ADMIN_USERS } = require('../config/permissions');

class PermissionsManager {
    /**
     * Vérifie si un membre a les permissions pour un type d'action donné
     * @param {GuildMember} member - Le membre Discord à vérifier
     * @param {string} type - Le type d'action ('ban', 'suspect', 'admin')
     * @returns {boolean} - True si le membre a les permissions
     */
    static checkPermission(member, type) {
        // Vérification pour les admins (peuvent tout faire)
        if (ADMIN_USERS.includes(member.id)) {
            return true;
        }
    
        // Vérifier si member.roles existe et a une propriété cache
        if (!member || !member.roles || !member.roles.cache) {
            console.error('Erreur: member.roles.cache n\'est pas disponible', { 
                memberId: member?.id,
                hasRoles: !!member?.roles,
                memberType: typeof member,
                memberKeys: member ? Object.keys(member) : null
            });
            return false;
        }
    
        // Journaliser les rôles pour le débogage
        const memberRoles = Array.from(member.roles.cache.keys());
        console.log(`Rôles pour ${member.user?.tag || member.id}:`, memberRoles);
    
        // Vérification selon le type d'action
        switch(type.toLowerCase()) {
            case 'ban':
            case 'banned':
                return memberRoles.some(roleId => BAN_ROLES.includes(roleId));
            case 'suspect':
                return memberRoles.some(roleId => SUSPECT_ROLES.includes(roleId));
            case 'admin':
                return ADMIN_USERS.includes(member.id);
            default:
                return false;
        }
    }    
    /**
     * Obtient les types d'actions autorisées pour un membre
     * @param {GuildMember} member - Le membre Discord
     * @returns {Object} - Objet avec les permissions
     */
    static getPermissions(member) {
        return {
            canBan: this.checkPermission(member, 'ban'),
            canSuspect: this.checkPermission(member, 'suspect'),
            isAdmin: this.checkPermission(member, 'admin')
        };
    }
}

module.exports = PermissionsManager;
