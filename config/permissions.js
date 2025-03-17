// Liste des ID des rôles et utilisateurs autorisés
module.exports = {
    // Rôles autorisés à créer des dossiers bannis
    BAN_ROLES: [
        '1343697381350313984',
        '1335004030224699513',
        '1336306390368653383',
        '1343706514841403433'
    ],

    // Rôles autorisés à créer des dossiers suspects
    SUSPECT_ROLES: [
        // Rôles qui peuvent créer les deux types
        '1343697381350313984',
        '1335004030224699513',
        '1336306390368653383',
        '1343706514841403433',
        // Rôles qui peuvent créer uniquement des suspects
        '1343706456024813611',
        '1335004221845536898',
        '1336306060750749777',
        '1335004298513485924',
        '1341404488279396528'
    ],

    // Utilisateurs autorisés à reconstruire la base de données
    ADMIN_USERS: [
        '496722398310039552',
        '319553384938209280',
        '994175701030797342'
    ]
};
