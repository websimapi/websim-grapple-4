import * as THREE from 'three';
import { isPointOnOBB } from './utils.js';

export class TrackManager {
    constructor(scene) {
        this.scene = scene;
        this.segments = [];
        this.posts = [];
        this.width = 12; 

        // Texture Loading
        const loader = new THREE.TextureLoader();
        this.roadTexture = loader.load('./asphalt_tile.png');
        this.roadTexture.wrapS = THREE.RepeatWrapping;
        this.roadTexture.wrapT = THREE.RepeatWrapping;
        this.roadTexture.repeat.set(1, 4);
        
        // Texture Filtering for smoother look
        this.roadTexture.minFilter = THREE.LinearMipmapLinearFilter;
        this.roadTexture.magFilter = THREE.LinearFilter;
        this.roadTexture.anisotropy = 16; // Maximize sharpness at angles

        this.roadMat = new THREE.MeshStandardMaterial({ 
            map: this.roadTexture,
            roughness: 0.4, // Increased roughness for less plastic look
            metalness: 0.1, // Reduced metalness
            color: 0x666666 // Slightly lighter to show texture details
        });

        const postTexture = loader.load('./post_texture.png');
        this.postGeo = new THREE.CylinderGeometry(0.8, 0.8, 6, 16);
        this.postMat = new THREE.MeshStandardMaterial({ 
            map: postTexture,
            color: 0xffffff, 
            emissive: 0xff4400,
            emissiveIntensity: 1.5,
            metalness: 0.8,
            roughness: 0.2
        });

        // Initial generation state
        this.currentPos = new THREE.Vector3(0, 0, 0);
        this.currentDir = new THREE.Vector3(0, 0, 1); // Moving +Z
        this.segmentLength = 50;

        // Build initial straight
        this.addSegment('straight', 80);
        this.generateNextSegment();
        this.generateNextSegment();
        this.generateNextSegment();
    }

    addSegment(type, length = 50, turnDir = 1, angle = Math.PI / 2) {
        const seg = {
            type: type,
            start: this.currentPos.clone(),
            dir: this.currentDir.clone(),
            length: length,
            width: this.width,
            mesh: null,
            angle: 0 // Rotation of the mesh
        };

        // Visuals
        const geo = new THREE.PlaneGeometry(this.width, length);
        const mesh = new THREE.Mesh(geo, this.roadMat);
        mesh.rotation.x = -Math.PI / 2;

        // Position center of segment
        const centerOffset = this.currentDir.clone().multiplyScalar(length / 2);
        mesh.position.copy(this.currentPos).add(centerOffset);

        // Rotate mesh to align with direction
        // Default plane looks at +Z. Calculate angle from (0,0,1)
        const baseAngle = Math.atan2(this.currentDir.x, this.currentDir.z);
        mesh.rotation.z = -baseAngle; // Counter-rotate z because plane is x-rotated
        seg.angle = -baseAngle;

        this.scene.add(mesh);
        seg.mesh = mesh;
        this.segments.push(seg);

        // Update head
        this.currentPos.add(this.currentDir.clone().multiplyScalar(length));

        // If it's a turn, we need a post and to rotate direction for NEXT segment
        if (type === 'turn') {
            // Create a corner patch to fill the gap
            const cornerGeo = new THREE.PlaneGeometry(this.width, this.width);
            const cornerMesh = new THREE.Mesh(cornerGeo, this.roadMat);
            cornerMesh.rotation.x = -Math.PI / 2;
            
            // Position corner center: CurrentPos (end of straight) + Half Width forward
            const cornerCenterOffset = this.currentDir.clone().multiplyScalar(this.width / 2);
            const cornerCenter = this.currentPos.clone().add(cornerCenterOffset);
            
            cornerMesh.position.copy(cornerCenter);
            cornerMesh.position.y = 0.05; // Slightly raised to prevent z-fighting
            
            // Align corner rotation with incoming road
            cornerMesh.rotation.z = seg.mesh.rotation.z;

            this.scene.add(cornerMesh);

            this.segments.push({
                type: 'corner',
                mesh: cornerMesh,
                start: this.currentPos.clone(),
                dir: this.currentDir.clone(),
                length: this.width,
                width: this.width,
                angle: seg.angle // Match alignment of incoming road
            });

            // Place post on the "inside" of the turn
            // Perpendicular vector
            const perp = new THREE.Vector3(-this.currentDir.z, 0, this.currentDir.x); // Left vector relative to forward

            // If turnDir is 1 (Right/CCW rotation from South to East), post should be on Right.
            // If turnDir is -1 (Left/CW rotation from South to West), post should be on Left.
            // perp is Left. 

            const postPos = cornerCenter.clone();
            
            // Calculate vector pointing to the "Inner Corner" (Apex)
            // This requires moving laterally (Inside) and longitudinally (Backwards/Against Flow)
            // to clear the intersection.
            // Vector = (InsideDirection) + (BackwardsDirection)
            // InsideDirection: -perp * turnDir (Right for 1, Left for -1)
            // BackwardsDirection: -currentDir
            const cornerVector = perp.clone().multiplyScalar(-turnDir).sub(this.currentDir).normalize();
            
            // Move post diagonally out from the corner center
            // Road half-width is 6. Corner diagonal is approx 8.5.
            // Place at 12 to be safely off the road ("move up some")
            postPos.add(cornerVector.multiplyScalar(12));

            const post = new THREE.Mesh(this.postGeo, this.postMat);
            post.position.copy(postPos);
            post.position.y = 2;
            this.scene.add(post);

            this.posts.push({
                mesh: post,
                position: postPos,
                active: true
            });

            // Rotate direction for next segment logic:
            // 1. We are currently at the "End" of the straight (Start of corner).
            // 2. We need to effectively "move" to the new start point for the next segment.
            //    The next segment should start at the edge of the corner square in the NEW direction.
            
            // Move cursor to Corner Center
            this.currentPos.add(cornerCenterOffset);

            // Rotate direction
            const rotationAxis = new THREE.Vector3(0, 1, 0);
            this.currentDir.applyAxisAngle(rotationAxis, turnDir * angle); 
            
            // Move cursor from Center to New Edge
            this.currentPos.add(this.currentDir.clone().multiplyScalar(this.width / 2));
        }
    }

    generateNextSegment() {
        // Simple procedural logic
        const rand = Math.random();

        // 50% straight, 50% turn (split left/right)
        // Removed U-turns (180) as they caused mesh overlapping issues ("broken" generation)

        if (rand < 0.4) {
             this.addSegment('straight', 80 + Math.random() * 60); // Longer straights
        } else {
            const turnDir = Math.random() > 0.5 ? 1 : -1; // 1 = Left, -1 = Right
            const angle = Math.PI / 2; // Fixed 90 degree turns

            // Add a straight section leading up to the turn
            // Increased length to prevent turns happening "too soon"
            this.addSegment('turn', 50 + Math.random() * 30, turnDir, angle);
        }
    }

    isOnTrack(position) {
        // Safe zone at start (0,0,0) to prevent immediate wipeout on spawn
        if (position.length() < 15) return true;

        // Check against active segments
        // Increased checkCount to prevent skipping segments if generation is fast
        const checkCount = Math.min(this.segments.length, 20);
        const startIndex = Math.max(0, this.segments.length - checkCount);

        for (let i = startIndex; i < this.segments.length; i++) {
            const seg = this.segments[i];
            // Added slight tolerance (+1) to width/length to handle seams and float precision
            if (isPointOnOBB(position, seg.mesh.position, seg.width + 1, seg.length + 1, seg.angle)) {
                return true;
            }
        }

        // If we are mid-grapple, we might be temporarily off "road" mesh but swinging through air.
        // We handle this by being lenient near posts in Game logic or making corners filled.
        // For arcade style, let's add invisible collision spheres at corners (posts).
        for(let p of this.posts) {
            // Being near a post is safe
            if (position.distanceTo(p.position) < this.width * 1.5) return true;
        }

        return false;
    }

    getNearestPost(position) {
        let nearest = null;
        let minDist = Infinity;

        // Optimization: Only check recent posts
        const checkCount = Math.min(this.posts.length, 4);
        const startIndex = this.posts.length - checkCount;

        for (let i = startIndex; i < this.posts.length; i++) {
            const post = this.posts[i];
            const dist = position.distanceTo(post.position);
            if (dist < minDist) {
                minDist = dist;
                nearest = post;
            }
        }
        return { post: nearest, distance: minDist };
    }
}