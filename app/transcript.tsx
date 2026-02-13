import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useEffect, useRef } from 'react';

export default function TranscriptScreen() {
  const waveFlow = useRef(new Animated.Value(0)).current;
  const waveSwell = useRef(new Animated.Value(0)).current;
  const waveDrift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const flowAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(waveFlow, {
          toValue: 1,
          duration: 8200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
        Animated.timing(waveFlow, {
          toValue: 0,
          duration: 8200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
      ])
    );

    const swellAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(waveSwell, {
          toValue: 1,
          duration: 6400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(waveSwell, {
          toValue: 0,
          duration: 6400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
      ])
    );

    const driftAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(waveDrift, {
          toValue: 1,
          duration: 11200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
        Animated.timing(waveDrift, {
          toValue: 0,
          duration: 11200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
      ])
    );

    flowAnim.start();
    swellAnim.start();
    driftAnim.start();

    return () => {
      flowAnim.stop();
      swellAnim.stop();
      driftAnim.stop();
    };
  }, [waveDrift, waveFlow, waveSwell]);

  const bubbleOneStyle = {
    transform: [
      {
        translateX: waveFlow.interpolate({
          inputRange: [0, 1],
          outputRange: [-26, 34],
        }),
      },
      {
        translateY: waveSwell.interpolate({
          inputRange: [0, 1],
          outputRange: [-8, 10],
        }),
      },
    ],
    opacity: waveSwell.interpolate({
      inputRange: [0, 1],
      outputRange: [0.24, 0.5],
    }),
  };

  const bubbleTwoStyle = {
    transform: [
      {
        translateX: waveDrift.interpolate({
          inputRange: [0, 1],
          outputRange: [34, -30],
        }),
      },
      {
        translateY: waveFlow.interpolate({
          inputRange: [0, 1],
          outputRange: [10, -8],
        }),
      },
      {
        scaleX: waveSwell.interpolate({
          inputRange: [0, 1],
          outputRange: [1.03, 0.96],
        }),
      },
    ],
    opacity: waveSwell.interpolate({
      inputRange: [0, 1],
      outputRange: [0.2, 0.44],
    }),
  };

  const bubbleThreeStyle = {
    transform: [
      {
        translateX: waveDrift.interpolate({
          inputRange: [0, 1],
          outputRange: [-18, 24],
        }),
      },
      {
        translateY: waveFlow.interpolate({
          inputRange: [0, 1],
          outputRange: [-12, 14],
        }),
      },
      {
        scaleX: waveSwell.interpolate({
          inputRange: [0, 1],
          outputRange: [0.95, 1.05],
        }),
      },
    ],
    opacity: waveSwell.interpolate({
      inputRange: [0, 1],
      outputRange: [0.16, 0.36],
    }),
  };

  return (
    <View style={styles.container}>
      <View style={styles.backgroundSeaTint} />
      <Animated.View style={[styles.backgroundBubble, styles.backgroundBubbleOne, bubbleOneStyle]} />
      <Animated.View style={[styles.backgroundBubble, styles.backgroundBubbleTwo, bubbleTwoStyle]} />
      <Animated.View style={[styles.backgroundBubble, styles.backgroundBubbleThree, bubbleThreeStyle]} />
      <Animated.View style={[styles.backgroundBubble, styles.backgroundBubbleFour, bubbleTwoStyle]} />
      <Animated.View style={[styles.backgroundBubble, styles.backgroundBubbleFive, bubbleThreeStyle]} />
      <Animated.View style={[styles.backgroundBubble, styles.backgroundBubbleSix, bubbleOneStyle]} />
      <View style={styles.content}>
        <View style={styles.heroBlock}>
          <Text style={styles.title}>Transcript</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f2f2f7',
  },
  content: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 20,
  },
  heroBlock: {
    width: '100%',
    maxWidth: 640,
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 10,
    letterSpacing: -0.8,
  },
  backgroundSeaTint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(152, 207, 246, 0.18)',
    pointerEvents: 'none',
  },
  backgroundBubble: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: 'rgba(102, 181, 235, 0.28)',
    pointerEvents: 'none',
  },
  backgroundBubbleOne: {
    top: 74,
    right: 42,
    width: 112,
    height: 112,
    backgroundColor: 'rgba(92, 172, 228, 0.34)',
  },
  backgroundBubbleTwo: {
    top: 120,
    left: 34,
    width: 64,
    height: 64,
    backgroundColor: 'rgba(113, 194, 243, 0.42)',
  },
  backgroundBubbleThree: {
    top: 182,
    right: 112,
    width: 88,
    height: 88,
    backgroundColor: 'rgba(79, 159, 220, 0.3)',
  },
  backgroundBubbleFour: {
    top: 266,
    left: 72,
    width: 48,
    height: 48,
    backgroundColor: 'rgba(128, 203, 248, 0.46)',
  },
  backgroundBubbleFive: {
    top: 338,
    right: 36,
    width: 72,
    height: 72,
    backgroundColor: 'rgba(102, 181, 235, 0.38)',
  },
  backgroundBubbleSix: {
    top: 410,
    left: 120,
    width: 56,
    height: 56,
    backgroundColor: 'rgba(85, 167, 227, 0.34)',
  },
});
