import socket
import time
import asyncio
import numpy as np
from bleak import BleakClient
from bleak import BleakScanner
from bleak.backends.device import BLEDevice
from bleak.backends.scanner import AdvertisementData

UDP_IP = "127.0.0.1"
UDP_PORT = 2000
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

def socket_send(msg):
    try:
        sock.sendto(bytes(msg, "utf-8"), (UDP_IP, UDP_PORT))
    except (socket.timeout, ConnectionRefusedError):
        sock.close()

OPENWIND_WIND_CHARACTERISTIC_UUID = '0000cc91-0000-1000-8000-00805f9b34fb'
OPENWIND_MOV_ENABLE_CHARACTERISTIC_UUID = '0000aa82-0000-1000-8000-00805f9b34fb'
OPENWIND_FW_CHARACTERISTIC_UUID = '00002a26-0000-1000-8000-00805f9b34fb'

deviceFound = False
deviceAddress = None
deviceConnected = False

def WIND_DATA_CALLBACK(sender, data):
    global fw_number
    
    # Extract wind data
    AWA = float((data[2] << 8) | data[1]) * 0.1  # °
    AWS = float((data[4] << 8) | data[3]) * 0.01  # kts
    
    print(f"AWA: {AWA:.1f}° AWS: {AWS:.1f} kts")
    
    # Send wind data to SignalK plugin
    wind_sentence = f"$WIMWV,{AWA:.1f},R,{AWS:.1f},N,A*"
    socket_send(wind_sentence + "\n")
    
    # Only process heading data if firmware supports it
    if float(fw_number) >= 1.25:
        YAW = float((data[6] << 8) | data[5]) * 1/16 - 90  # °
        socket_send(f"RAWYAW: {YAW:.1f}°\n")
        
        # Normalize YAW to 0-360
        if YAW < 0:
            YAW = 360 + YAW
            
        print(f"YAW: {YAW:.1f}°")
        
        # Send heading data to SignalK plugin
        heading_sentence = f"$WIHDM,{YAW:.1f},M*"
        socket_send(heading_sentence + "\n")

def simple_callback(device: BLEDevice, advertisement_data: AdvertisementData):
    global deviceFound, deviceAddress
    if device.name == "OpenWind":
        print("Found OpenWind device")
        deviceFound = True
        deviceAddress = device.address

def OW_DISCONNECT_CALLBACK(client):
    global deviceConnected
    deviceConnected = False
    print(f"OpenWind disconnected: {client.address}")

async def run():
    global deviceFound, deviceAddress, deviceConnected, fw_number
    
    # Scan for OpenWind device
    scanner = BleakScanner(simple_callback)
    
    print("Scanning for OpenWind device...")
    await scanner.start()
    await asyncio.sleep(5.0)
    await scanner.stop()
    
    if not deviceFound:
        print("OpenWind device not found")
        return
    
    # Connect to device
    async with BleakClient(deviceAddress) as client:
        deviceConnected = True
        print(f"Connected to OpenWind: {deviceAddress}")
        
        # Get firmware version
        fw_number = await client.read_gatt_char(OPENWIND_FW_CHARACTERISTIC_UUID)
        fw_version = "".join(map(chr, fw_number))
        print(f"Firmware version: {fw_version}")
        
        
        # Enable notifications
        write_value = bytearray([0x2C])
        await client.write_gatt_char(OPENWIND_MOV_ENABLE_CHARACTERISTIC_UUID, write_value)
        await asyncio.sleep(1.0)
        
        # Start receiving data
        await client.start_notify(OPENWIND_WIND_CHARACTERISTIC_UUID, WIND_DATA_CALLBACK)
        print("Started receiving OpenWind data...")
        
        # Keep connection alive
        while client.is_connected:
            await asyncio.sleep(1.0)

def main():
    while True:
        try:
            loop = asyncio.get_event_loop()
            loop.run_until_complete(run())
            
            print("Connection lost, reconnecting...")
            time.sleep(5)
            
        except Exception as e:
            print(f"Error: {e}")
            print("Retrying in 5 seconds...")
            time.sleep(5)

if __name__ == "__main__":
    main()
