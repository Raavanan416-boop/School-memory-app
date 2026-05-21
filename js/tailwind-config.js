tailwind.config = {
  theme: {
    extend: {
      colors: {
        // Warm cream backgrounds
        cream: { 50:'#fdf8f0', 100:'#f9f0e1', 200:'#f5e8d0', 300:'#efe0c4', 400:'#e8d5b0', 500:'#dcc89c' },
        // Navy blue primary
        navy: { 50:'#e8eef5', 100:'#c5d4e8', 200:'#9fb6d6', 300:'#7998c4', 400:'#5c82b7', 500:'#1e3a5f', 600:'#1a3355', 700:'#152b48', 800:'#10223b', 900:'#0b1a2e' },
        // Warm accent
        warm: { 50:'#fdf6ed', 100:'#f9e8d0', 200:'#f3d1a1', 300:'#edba72', 400:'#d4991a', 500:'#b87d0f', 600:'#9c6508', 700:'#7a4d04' },
        // Functional
        accent: { blue:'#2563eb', red:'#dc2626', green:'#16a34a', orange:'#ea580c' }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        handwriting: ['Caveat', 'cursive'],
        display: ['Playfair Display', 'serif'],
        serif: ['Georgia', 'serif']
      },
      animation: {
        'fadeIn': 'fadeIn 0.5s ease-out forwards',
        'slideUp': 'slideUp 0.4s ease-out forwards',
        'scaleIn': 'scaleIn 0.3s ease-out forwards',
        'float': 'float 6s ease-in-out infinite'
      },
      keyframes: {
        fadeIn: { '0%': { opacity:'0' }, '100%': { opacity:'1' } },
        slideUp: { '0%': { opacity:'0', transform:'translateY(20px)' }, '100%': { opacity:'1', transform:'translateY(0)' } },
        scaleIn: { '0%': { transform:'scale(0.9)', opacity:'0' }, '100%': { transform:'scale(1)', opacity:'1' } },
        float: { '0%,100%': { transform:'translateY(0)' }, '50%': { transform:'translateY(-8px)' } }
      },
      boxShadow: {
        'card': '0 2px 12px rgba(0,0,0,0.06)',
        'card-hover': '0 4px 20px rgba(0,0,0,0.1)',
        'nav': '0 -1px 10px rgba(0,0,0,0.05)',
        'warm': '0 4px 16px rgba(30,58,95,0.1)'
      }
    }
  }
};
