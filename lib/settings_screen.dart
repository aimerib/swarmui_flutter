import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'services/swarm_ui_api.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  SettingsScreenState createState() => SettingsScreenState();
}

class SettingsScreenState extends State<SettingsScreen> {
  final _formKey = GlobalKey<FormState>();
  final TextEditingController _serverController = TextEditingController();

  @override
  void dispose() {
    _serverController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final api = Provider.of<SwarmUIAPI>(context, listen: false);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Form(
          key: _formKey,
          child: Column(
            children: [
              TextFormField(
                controller: _serverController,
                decoration: const InputDecoration(
                  labelText: 'Server Address',
                  hintText: 'http://localhost:7801',
                ),
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return 'Please enter the server address';
                  }
                  // Add more validation if necessary
                  return null;
                },
              ),
              const SizedBox(height: 20),
              ElevatedButton(
                onPressed: () async {
                  if (_formKey.currentState!.validate()) {
                    await api.setServerAddress(_serverController.text);
                    if (context.mounted) {
                      Navigator.of(context).pop(); // Return to the main screen
                    }
                  }
                },
                child: const Text('Save'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
