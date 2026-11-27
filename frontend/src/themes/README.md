# Theme System Documentation

## Overview

The ground station application supports multiple themes with completely customizable color schemes and visual styles. The theme system is built on Material-UI's theming capabilities and allows for easy addition of new themes.

## Current Themes

### Built-in Themes

| Theme | Appearance | Suggested waterfall colormap |
| --- | --- | --- |
| Auto (System) | Follows the system's dark/light preference | Any |
| Dark (default) | Neutral dark grey with muted blue accents | Cosmic |
| Slate Blue | Dark grey with blue and mint accents | Iceberg |
| Light | Light surfaces for daytime use | Light |
| Night (OLED) | Black surfaces with purple accents | Cosmic |
| Cyberpunk | Charcoal grey with neon cyan and magenta accents | Cyberpunk |
| Midnight RX | Dark navy panels with blue accents | Midnight RX |
| Classic RF | Charcoal panels with soft green controls | Classic RF |
| Phosphor | Almost-black green panels with bright green highlights | Phosphor |
| Signal Lab | Graphite panels with teal and yellow accents | Viridis |

Interface themes and waterfall colormaps are selected independently. Choose the
theme in Settings → Preferences (or initial setup), and the colormap in the
waterfall FFT settings. Recorded waterfall generation offers the same colormaps.

### SDR palette sources

- Midnight RX uses the [SDR++ Electric palette](https://github.com/AlexandreRouma/SDRPlusPlus/blob/master/root/res/colormaps/electric.json), credited to Ryzerth, with a Deep Blue-inspired interface.
- Classic RF uses the [Gqrx palette distributed by SDR++](https://github.com/AlexandreRouma/SDRPlusPlus/blob/master/root/res/colormaps/gqrx.json), credited to csete (Alexandru Csete).
- Phosphor uses [SDR++ Classic Green](https://github.com/AlexandreRouma/SDRPlusPlus/blob/master/root/res/colormaps/classic_green.json), credited to Paul (PD0SWL). Its waterfall progresses through blue, cyan, green and orange/red, with dark red at the upper end.
- Signal Lab pairs with Viridis, also offered by [SDRangel](https://github.com/f4exb/sdrangel/blob/master/sdrbase/util/colormap.cpp). The original 256-sample table is from [BIDS/colormap](https://github.com/BIDS/colormap/blob/master/colormaps.py), by Nathaniel J. Smith, Stefan van der Walt and Eric Firing, released under [CC0](https://creativecommons.org/publicdomain/zero/1.0/). Samples are rounded to 8-bit RGB without changing the linear intensity scale.

The SDR++ palette resources are distributed under its GPL-3.0 license, compatible
with this project's license. Attribution above applies to the imported tables;
the interface theme colors are original adaptations.

The palette tables are intentionally bundled in both
`components/waterfall/worker-modules/palettes.json` and `backend/fft/palettes.json`
so the frontend build and backend package work independently. Keep these files
identical when changing a palette, and verify that both renderers return the same
RGB values. The backend package includes its table as package data.

## Adding a New Theme

### Step 1: Define Theme Configuration

Edit `theme-configs.js` and add your theme to the `themeConfigs` object:

```javascript
export const themeConfigs = {
    // ... existing themes ...

    'my-custom-theme': {
        mode: 'dark', // or 'light'
        primary: { main: '#yourcolor' },
        secondary: { main: '#yourcolor' },
        success: { main: '#yourcolor' },
        warning: { main: '#yourcolor' },
        error: { main: '#yourcolor' },
        info: { main: '#yourcolor' },
        background: {
            default: '#yourcolor',  // Main background
            paper: '#yourcolor',     // Card/panel backgrounds
            elevated: '#yourcolor',  // Raised surfaces
        },
        border: {
            main: '#yourcolor',   // Default borders
            light: '#yourcolor',  // Lighter borders
            dark: '#yourcolor',   // Darker borders
        },
        overlay: {
            light: 'rgba(...)',   // Subtle overlays
            medium: 'rgba(...)',  // Medium overlays
            dark: 'rgba(...)',    // Strong overlays
        },
        status: {
            connected: '#yourcolor',     // Connection active
            connecting: '#yourcolor',    // Connection in progress
            disconnected: '#yourcolor',  // Connection lost
            polling: '#yourcolor',       // Fallback connection mode
        },
        // Add custom properties as needed
        customProperty: 'value',
    },
};
```

### Step 2: Register the Theme

Add its stable `id` and display `name` to `getAvailableThemesWithMetadata()` in
`theme-configs.js`. Both the preferences form and initial setup use this registry.
Theme names are preset names displayed directly; the legacy `preferences.theme_*`
locale keys do not drive these selectors.

### Step 3: Test Your Theme

1. Start the application
2. Go to Settings → Preferences
3. Select your new theme from the dropdown
4. Click "Save Preferences"
5. Reload if requested to apply the saved theme

## Theme Structure

### Required Properties

Every theme MUST define:
- `mode`: 'dark' or 'light' (affects Material-UI component defaults)
- `primary`, `secondary`, `success`, `warning`, `error`, `info` color objects
- `background.default`, `background.paper`, `background.elevated`
- `border.main`, `border.light`, `border.dark`
- `overlay.light`, `overlay.medium`, `overlay.dark`
- `status.connected`, `status.connecting`, `status.disconnected`, `status.polling`

### Optional Properties

You can add custom properties for special use cases:
```javascript
{
    // Custom neon glow effects for cyberpunk theme
    neonGlow: {
        cyan: '0 0 10px #00ffff, 0 0 20px #00ffff',
    },

    // Custom accent colors
    accent: {
        primary: '#yourcolor',
        secondary: '#yourcolor',
    },
}
```

Access these in components via `theme.palette.yourCustomProperty`.

## Using Theme Values in Components

### In sx Props
```jsx
<Box sx={{
    backgroundColor: 'background.paper',
    borderColor: 'border.main',
    color: 'text.primary',
}}>
```

### In Styled Components
```jsx
const StyledBox = styled(Box)(({ theme }) => ({
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${theme.palette.border.main}`,
}));
```

### Accessing Custom Properties
```jsx
const MyComponent = () => {
    const theme = useTheme();
    return (
        <Box sx={{
            boxShadow: theme.palette.neonGlow?.cyan, // Optional chaining for custom props
        }}>
    );
};
```

## Best Practices

### 1. Color Consistency
- Use semantic color names (success, warning, error) instead of specific colors
- Maintain consistent contrast ratios (WCAG AA minimum: 4.5:1)

### 2. Mode Compatibility
- Set `mode: 'dark'` for dark backgrounds
- Set `mode: 'light'` for light backgrounds
- This affects Material-UI's automatic text color calculations

### 3. Testing
Test your theme with:
- Different screen sizes
- Various components (buttons, forms, tables, maps)
- Satellite tracking visualization
- Waterfall display
- Connection status indicators

### 4. Accessibility
- Ensure sufficient contrast between text and background
- Test with screen readers
- Verify focus indicators are visible
- Check color-blind friendly combinations

## Advanced Customization

### Component-Specific Overrides

You can override Material-UI component styles in `theme.js`:

```javascript
components: {
    MuiButton: {
        styleOverrides: {
            root: {
                borderRadius: themeName === 'cyberpunk' ? '0px' : '4px',
            },
        },
    },
}
```

### Dynamic Theme Switching

Theme changes are handled automatically through Redux:
1. User selects theme in preferences
2. Redux stores the preference
3. `App.jsx` reads the preference and calls `setupTheme(themeName)`
4. Material-UI re-renders with new theme

### Canvas Elements

Note: HTML5 Canvas elements (waterfall display) cannot use theme tokens directly. They require actual color values. When adding a new theme, you may need to update canvas drawing code manually.

## Troubleshooting

### Theme Not Applying
1. Check browser console for errors
2. Verify theme name matches exactly (case-sensitive)
3. Clear browser cache and reload
4. Check that all required properties are defined

### Colors Look Wrong
1. Verify `mode` is set correctly ('dark' or 'light')
2. Check contrast ratios
3. Test in different browsers
4. Verify rgba values have correct alpha channel

### Missing Preset Name
1. Register the preset's `id` and `name` in `getAvailableThemesWithMetadata()`
2. Keep the `id` identical to its key in `themeConfigs`

## File Structure

```
frontend/src/
├── themes/
│   ├── theme-configs.js    # Theme definitions
│   └── README.md           # This file
├── theme.js                # Theme factory function
└── i18n/locales/
    ├── en/settings.json    # English translations
    ├── el/settings.json    # Greek translations
    └── ...                 # Other locales
```

## Contributing New Themes

When contributing a new theme:
1. Follow the color scheme guidelines
2. Test thoroughly across all pages
3. Register the display name for the preferences and setup selectors
4. Document any custom properties
5. Include screenshots in your PR
6. Verify accessibility standards

## Examples

### Minimal Theme
```javascript
'minimal': {
    mode: 'light',
    primary: { main: '#000000' },
    secondary: { main: '#666666' },
    success: { main: '#4caf50' },
    warning: { main: '#ff9800' },
    error: { main: '#f44336' },
    info: { main: '#2196f3' },
    background: {
        default: '#ffffff',
        paper: '#f5f5f5',
        elevated: '#eeeeee',
    },
    border: {
        main: '#cccccc',
        light: '#dddddd',
        dark: '#999999',
    },
    overlay: {
        light: 'rgba(0, 0, 0, 0.02)',
        medium: 'rgba(0, 0, 0, 0.05)',
        dark: 'rgba(0, 0, 0, 0.2)',
    },
    status: {
        connected: '#4caf50',
        connecting: '#ff9800',
        disconnected: '#f44336',
        polling: '#f57c00',
    },
}
```

### Advanced Theme with Custom Properties
```javascript
'terminal': {
    mode: 'dark',
    // ... standard properties ...
    monospace: {
        fontFamily: '"Courier New", monospace',
        fontSize: '14px',
        lineHeight: 1.5,
    },
    scanlines: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 255, 0, 0.03) 2px, rgba(0, 255, 0, 0.03) 4px)',
}
```
