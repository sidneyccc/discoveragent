# DiscoverAgent

A cross-platform React Native application that runs on both Web and iOS.

## Features

- 🌐 **Web Support**: Runs in any modern browser
- 📱 **iOS Support**: Native iOS app
- 🧭 **Navigation**: File-based routing with Expo Router
- 📘 **TypeScript**: Full type safety
- 🎨 **Modern UI**: Clean, responsive design

## Prerequisites

- Node.js 18+ installed
- npm or yarn
- For iOS development: macOS with Xcode installed
- For iOS simulator: Xcode Command Line Tools

## Getting Started

### Install Dependencies

```bash
npm install
```

### Running the App

#### Web

Run the app in your browser:

```bash
npm run web
```

This will start the development server and open the app at `http://localhost:8081`

#### iOS Simulator

Make sure you have Xcode installed, then run:

```bash
npm run ios
```

This will build and launch the app in the iOS Simulator.

#### Development Mode

To start the Expo development server with options for all platforms:

```bash
npm start
```

Then press:
- `w` to open in web browser
- `i` to open in iOS simulator
- `r` to reload the app

## Project Structure

```
discoveragent/
├── app/                  # App screens and navigation
│   ├── _layout.tsx      # Root layout with navigation
│   ├── index.tsx        # Home screen
│   └── about.tsx        # About screen
├── components/          # Reusable components
├── assets/             # Images, fonts, and other assets
├── app.json            # Expo configuration
├── package.json        # Dependencies and scripts
└── tsconfig.json       # TypeScript configuration
```

## Adding New Screens

Expo Router uses file-based routing. To add a new screen:

1. Create a new `.tsx` file in the `app/` directory
2. Export a default component
3. The file name becomes the route (e.g., `app/profile.tsx` → `/profile`)

Example:

```tsx
// app/profile.tsx
import { View, Text } from 'react-native';

export default function ProfileScreen() {
  return (
    <View>
      <Text>Profile Screen</Text>
    </View>
  );
}
```

## Navigation

Use the `Link` component or `useRouter` hook for navigation:

```tsx
import { Link } from 'expo-router';
import { useRouter } from 'expo-router';

// Using Link component
<Link href="/about">Go to About</Link>

// Using router hook
const router = useRouter();
router.push('/about');
```

## Building for Production

### Web

```bash
npm run build:web
```

The static files will be in the `dist/` directory.

## Deploying to GitHub Pages

This project is configured for easy deployment to GitHub Pages.

### Option 1: Automatic Deployment (Recommended)

The project includes a GitHub Actions workflow that automatically deploys to GitHub Pages on every push to the `main` branch.

**Setup:**

1. Push your code to GitHub:
   ```bash
   git add .
   git commit -m "Setup GitHub Pages deployment"
   git push origin main
   ```

2. Enable GitHub Pages in your repository:
   - Go to Settings → Pages
   - Under "Build and deployment", select "GitHub Actions" as the source

3. The site will automatically deploy and be available at:
   `https://[your-username].github.io/discoveragent/`

### Option 2: Manual Deployment

Deploy manually using the gh-pages package:

```bash
npm run deploy
```

This will build and deploy the web app to the `gh-pages` branch.

### iOS

```bash
npx expo build:ios
```

Or use EAS Build for a more streamlined process:

```bash
npm install -g eas-cli
eas build --platform ios
```

## Tech Stack

- **React Native**: Cross-platform mobile framework
- **Expo**: Development platform and toolchain
- **Expo Router**: File-based navigation
- **TypeScript**: Static type checking
- **React Native Web**: Render React Native components on web

## Learn More

- [Expo Documentation](https://docs.expo.dev/)
- [React Native Documentation](https://reactnative.dev/)
- [Expo Router Documentation](https://docs.expo.dev/router/introduction/)

## License

MIT
