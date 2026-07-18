import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../../shared/models/latlng.dart';

/// Fixed-center-pin picker: the user pans the map, the pin stays centered,
/// and the address label is typed manually (no Google Places autocomplete —
/// that needs a Maps API key which isn't configured in this environment).
class MapPickerScreen extends StatefulWidget {
  const MapPickerScreen({super.key, required this.title, required this.initial});

  final String title;
  final LatLngPoint initial;

  @override
  State<MapPickerScreen> createState() => _MapPickerScreenState();
}

class _MapPickerScreenState extends State<MapPickerScreen> {
  late LatLngPoint _selected = widget.initial;
  final _addressController = TextEditingController();

  @override
  void dispose() {
    _addressController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: Stack(
        alignment: Alignment.center,
        children: [
          GoogleMap(
            initialCameraPosition: CameraPosition(
              target: LatLng(widget.initial.lat, widget.initial.lng),
              zoom: 15,
            ),
            onCameraMove: (position) {
              _selected = LatLngPoint(lat: position.target.latitude, lng: position.target.longitude);
            },
            myLocationEnabled: true,
            myLocationButtonEnabled: true,
          ),
          const IgnorePointer(
            child: Padding(
              padding: EdgeInsets.only(bottom: 36),
              child: Icon(Icons.location_pin, size: 42, color: Color(0xFF7C3AED)),
            ),
          ),
          Positioned(
            left: 16,
            right: 16,
            bottom: 16,
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    TextField(
                      controller: _addressController,
                      decoration: const InputDecoration(labelText: 'Label this location (optional)'),
                    ),
                    const SizedBox(height: 8),
                    ElevatedButton(
                      onPressed: () => Navigator.of(context).pop(
                        (point: _selected, address: _addressController.text.trim()),
                      ),
                      child: const Text('Confirm location'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
