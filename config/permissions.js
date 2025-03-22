// Liste des ID des rôles et utilisateurs autorisés
module.exports = {
    // Rôles autorisés à créer des dossiers bannis
    BAN_ROLES: [
        '1343697381350313984', // Fondateur
        '1335006538858758234', // Haut Staff
        '1335004030224699513', // Adminnistrateur
        '1336306390368653383', // Administrateur-Adjoint
        '1343706514841403433', // Aspirant Administrateur
    ],

    // Rôles autorisés à créer des dossiers suspects
    SUSPECT_ROLES: [
        // Rôles qui peuvent créer les deux types
        '1343697381350313984', // Fondateur
        '1335006538858758234', // Haut Staff
        '1335004030224699513', // Administrateur
        '1336306390368653383', // Administrateur-Adjoint
        '1343706514841403433', // Aspirant Administrateur
        // Rôles qui peuvent créer uniquement des suspects
        '1343706456024813611', // Major
        '1335004221845536898', // Moderateur
        '1341404488279396528', // Modérateur Test
        '1336306060750749777', // Helpeur
        '1352036054399582321', // Helpeur Test
        '1335004298513485924' // Apprenti Helpeur
    ],

    // Utilisateurs autorisés à reconstruire la base de données
    ADMIN_USERS: [
        '496722398310039552', // Axtazer
        '319553384938209280', // Shymi
        '994175701030797342' // Kyllowattes
    ],
    
    // Fonction utilitaire pour vérifier si un rôle de ban est aussi dans les rôles suspects
    validateConfig: function() {
        // Vérifier que tous les BAN_ROLES sont aussi dans SUSPECT_ROLES
        const missingRoles = this.BAN_ROLES.filter(role => !this.SUSPECT_ROLES.includes(role));
        if (missingRoles.length > 0) {
            console.error('ERREUR DE CONFIGURATION: Certains rôles BAN ne sont pas dans SUSPECT_ROLES:', missingRoles);
            // Ajouter automatiquement les rôles manquants
            this.SUSPECT_ROLES.push(...missingRoles);
            console.log('Rôles ajoutés automatiquement à SUSPECT_ROLES');
        }
        return this;
    }
}.validateConfig(); // Exécuter la validation au chargement