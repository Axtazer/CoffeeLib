module.exports = {
    // Tags pour les joueurs suspects
    suspectTags: [
        { 
            name: 'Comportement toxique', 
            value: 'toxic',
            emoji: '⚠️',
            keywords: ['toxic', 'toxique', 'comportement', 'insulte', 'agressif']
        },
        { 
            name: 'Harcèlement', 
            value: 'harassment',
            emoji: '⚠️',
            keywords: ['harcel', 'stalking', 'suivre', 'insistant']
        },
        { 
            name: 'Propos haineux', 
            value: 'hate_speech',
            emoji: '⚠️',
            keywords: ['haine', 'racisme', 'discrimination', 'hate']
        },
        { 
            name: 'Spam', 
            value: 'spam',
            emoji: '⚠️',
            keywords: ['spam', 'flood', 'spammer']
        },
        { 
            name: 'Crash', 
            value: 'crash',
            emoji: '⚠️',
            keywords: ['crash', 'lag', 'freeze']
        },
        { 
            name: 'Avatar NSFW', 
            value: 'nsfw_avatar',
            emoji: '⚠️',
            keywords: ['nsfw', 'avatar', 'inapproprié']
        },
        { 
            name: 'Menaces', 
            value: 'threats',
            emoji: '⚠️',
            keywords: ['menace', 'threat', 'intimidation']
        }
    ],

    // Tags pour les joueurs bannis
    bannedTags: [
        { 
            name: 'Récidive', 
            value: 'repeat_offender',
            emoji: '🚫',
            keywords: ['recidive', 'repeat', 'multiple']
        },
        { 
            name: 'Crash malicieux', 
            value: 'malicious_crash',
            emoji: '🚫',
            keywords: ['crash', 'malicieux', 'intentionnel']
        },
        { 
            name: 'Harcèlement grave', 
            value: 'severe_harassment',
            emoji: '🚫',
            keywords: ['harcel', 'grave', 'severe']
        },
        { 
            name: 'Comportement extrême', 
            value: 'extreme_behavior',
            emoji: '🚫',
            keywords: ['extreme', 'danger', 'grave']
        },
        { 
            name: 'Menaces graves', 
            value: 'severe_threats',
            emoji: '🚫',
            keywords: ['menace', 'grave', 'severe', 'danger']
        }
    ],

    // Fonction pour trouver les tags correspondants à un texte
    findMatchingTags: function(text, type = 'all') {
        const searchText = text.toLowerCase();
        const allTags = type === 'suspect' ? this.suspectTags :
                       type === 'banned' ? this.bannedTags :
                       [...this.suspectTags, ...this.bannedTags];

        return allTags.filter(tag => 
            tag.keywords.some(keyword => searchText.includes(keyword.toLowerCase())) ||
            searchText.includes(tag.name.toLowerCase()) ||
            searchText.includes(tag.value.toLowerCase())
        );
    },

    // Fonction pour formater un tag pour l'affichage
    formatTag: function(tag) {
        return `${tag.emoji} ${tag.name}`;
    }
};
