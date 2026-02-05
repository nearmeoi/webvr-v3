/**
 * Losari Cinematic Tour Data (Prototype)
 * 6 Zones - Automatic Flow - No Real Assets
 */

export const TOUR_DATA = [
    // --- ZONA 1: MUSEUM KOTA MAKASSAR ---
    {
        id: 0,
        title: 'Museum Kota Makassar',
        subtitle: 'Halaman Depan',
        description: 'Gerbang Masuk Museum',
        panorama: 'assets/Museum Kota Makassar/030_Halaman Depan_E6D21F.jpg',
        duration: 200, // Longer duration for exploration
        initialHeading: 0,
        autoRotate: false, // User explores manually
        hotspots: []
    },

    // --- ZONA 2: HEROIK ---
    {
        id: 1,
        title: 'Alam Indah', // Renamed from Heroik to match asset availability (Malino)
        subtitle: 'Malino',
        description: 'Sejuknya Alam Pegunungan',
        panorama: 'assets/Malino/1.jpg',
        duration: 10,
        initialHeading: 0,
        autoRotate: true,
        hotspots: []
    },

    // --- ZONA 3: SPIRITUAL ---
    {
        id: 2,
        title: 'Spiritual',
        subtitle: 'Masjid Terapung',
        description: 'Ketenangan & Ibadah',
        panorama: 'placeholder_zone3', // No specific asset found yet
        duration: 8,
        initialHeading: 180,
        autoRotate: true,
        hotspots: []
    },

    // --- ZONA 4: BUDAYA ---
    {
        id: 3,
        title: 'Budaya',
        subtitle: 'Tana Toraja',
        description: 'Tongkonan & Warisan Leluhur',
        panorama: 'assets/Toraja/1. Welcome/1.jpg',
        duration: 12,
        initialHeading: 0,
        autoRotate: true,
        // Example sub-scenes if needed
        scenes: [
            { id: 'toraja-1', path: 'assets/Toraja/1. Welcome/1.jpg', links: [] }
            // Add more toraja scenes here if requested
        ],
        hotspots: []
    },

    // --- ZONA 5: MASA DEPAN ---
    {
        id: 4,
        title: 'Masa Depan',
        subtitle: 'CPI & 99 Kubah',
        description: 'Visi Modern Makassar',
        panorama: 'placeholder_zone5',
        duration: 8,
        initialHeading: 45,
        autoRotate: true,
        hotspots: []
    },

    // --- ZONA 6: KULINER (NIGHT) ---
    {
        id: 5,
        title: 'Pantai Losari', // Renamed from Kuliner
        subtitle: 'Ikon Makassar',
        description: 'Suasana Pantai Losari',
        panorama: 'assets/Losari Beach/1.jpg',
        duration: 12,
        initialHeading: 0,
        autoRotate: true,
        hotspots: []
    }
];
