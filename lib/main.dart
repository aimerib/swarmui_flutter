import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:swarmui_flutter/services/swarm_ui_api.dart';
import 'package:swarmui_flutter/realtime_generation_screen.dart';
import 'package:swarmui_flutter/settings_screen.dart';

void main() {
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<SwarmUIAPI>(
          create: (_) => SwarmUIAPI(),
        ),
        // Add other providers if necessary
      ],
      child: const MyApp(),
    ),
  );
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
      title: 'Swarm UI App',
      home: MainScreen(),
    );
  }
}

class MainScreen extends StatefulWidget {
  const MainScreen({super.key});

  @override
  MainScreenState createState() => MainScreenState();
}

class MainScreenState extends State<MainScreen> {
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final api = Provider.of<SwarmUIAPI>(context);

    if (api.status == SwarmUIAPIStatus.needsSettings) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const SettingsScreen()),
        );
      });
    }

    if (api.status == SwarmUIAPIStatus.error) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        // Show an error dialog or snackbar
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(api.errorMessage ?? 'An error occurred')),
        );
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return const RealtimeGenerationScreen();
  }
}
