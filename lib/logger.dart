import 'package:logger/logger.dart';

/// Initializes and provides a singleton Logger instance.
///
/// This logger is configured to display the file name and line number
/// where each log statement is called from.
class AppLogger {
  static final Logger _logger = Logger(
    printer: PrettyPrinter(
      methodCount: 1,       // Shows the number of method calls in the stack trace
      errorMethodCount: 5,  // Number of method calls in the stack trace for errors
      lineLength: 80,       // Width of the log line
      colors: true,         // Colorful log messages
      printEmojis: true,    // Print an emoji for each log message
      printTime: false,     // Whether to print the timestamp
    ),
  );

  /// Returns the singleton Logger instance.
  static Logger get logger => _logger;
}
