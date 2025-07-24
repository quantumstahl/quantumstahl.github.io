var maskCanvas = document.createElement('canvas');
var maskCtx = maskCanvas.getContext('2d');

class Mapsdata{
    
    
    constructor(){
        
        
        
        
    }
    loadmapsdata(game){
        
        
        if(game.currentmap==0){
            if((game.collideswiths(link.objects[0],"chest")||game.isclose(link.objects[0], chest.objects[0]))&&buttonB.objects[0].mousepressed==true){
                if(chest.objects[0].animation==0){chest.objects[0].animation=1;game.addobject(lantern,chest.objects[0].x+25,chest.objects[0].y+45,50,70,0,false);}
           
            }
            
            if(game.collideswiths(link.objects[0],"trigger")){
                game.currentmap=1;
                link.objects[0].y=link.objects[0].y-100;
            }
            
                            
        }
        else if(game.currentmap==1){
            
            //MAKE IT DARK
            maskCanvas.width = canvas.width;
            maskCanvas.height = canvas.height;
            maskCtx.fillStyle = "rgba(0, 0, 0, 0.8)";
            maskCtx.fillRect(0, 125, maskCanvas.width, maskCanvas.height);
            maskCtx.globalCompositeOperation = "destination-out";
            if(havelantern){
                maskCtx.beginPath();
                maskCtx.arc((canvas.width/2)+(link.objects[0].dimx/2),(canvas.height/2)+(link.objects[0].dimy/2),150,0,2*Math.PI,false);
                maskCtx.fill();
                maskCtx.closePath();
              //  maskCtx.fill();
            }
            
            if(mobileAndTabletCheck()){
            maskCtx.beginPath();//ABUTTON
            maskCtx.arc(canvas.width-250+75,canvas.height-250+75,68,0,2*Math.PI,false);
            maskCtx.fill();
            maskCtx.closePath();
            maskCtx.beginPath();//BBUTTON
            maskCtx.arc(canvas.width-400+75,canvas.height-400+75,68,0,2*Math.PI,false);
            maskCtx.fill();
            maskCtx.closePath();
            }
            if(torch!=null){
                for(let i=0;i<torch.objects.length;i++){
                     maskCtx.beginPath();
                    if(torch.objects[i].animation==1)maskCtx.arc((torch.objects[i].x+game.getcamerax())+(torch.objects[i].dimx/2),(torch.objects[i].y+game.getcameray())+(torch.objects[i].dimy/2),200,0,2*Math.PI,false);
                    maskCtx.fill();
                    maskCtx.closePath();
                }
            }
            ctx.drawImage(maskCanvas, 0, 0);
            
            game.createlightning();
                           game.createrain();
            
            if(game.collideswiths(link.objects[0],"trigger")){
                
                for(let i=0;i<trigger.objects.length;i++){
                    
                    if(game.collideswithanoterobject(link.objects[0],trigger.objects[i])){
                        
                        if(i==0){game.currentmap=0;link.objects[0].y=link.objects[0].y+100;}
                        else if (i==1){game.currentmap=2;link.objects[0].y=link.objects[0].y+100;}
                        else if(i==2){game.currentmap=3;link.objects[0].y=link.objects[0].y+100;}  
                    }
                }
            }
        }
        else if(game.currentmap==2){
            if(game.collideswiths(link.objects[0],"trigger")){
                
                
                if(game.collideswithanoterobject(link.objects[0],trigger.objects[0])){
                    game.currentmap=1;
                    link.objects[0].y=link.objects[0].y-100;
                }
                if(game.collideswithanoterobject(link.objects[0],trigger.objects[1])){
                    
                    game.currentmap=4;
                    link.objects[0].x=link.objects[0].x+120;
                    
                }
                if(game.collideswithanoterobject(link.objects[0],trigger.objects[2])){
                    
                    game.currentmap=5;
                    link.objects[0].y=link.objects[0].y+130;
                    
                }
                
                
            }
            
        }
        else if(game.currentmap==3){
            if(game.collideswiths(link.objects[0],"trigger")){
                game.currentmap=1;
                link.objects[0].y=link.objects[0].y-100;
            }
            
        }
        else if(game.currentmap==4){
            
            torch.objects[0].animation=1;

            if(game.collideswiths(link.objects[0],"trigger")){
                game.currentmap=2;
                link.objects[0].x=link.objects[0].x-120;
            }
            
            maskCanvas.width = canvas.width;
            maskCanvas.height = canvas.height;

            maskCtx.fillStyle = "rgb(0, 0, 0)";
            maskCtx.fillRect(0, 125, maskCanvas.width, maskCanvas.height);
            maskCtx.globalCompositeOperation = "destination-out";

            if(havelantern){
                maskCtx.beginPath();
                maskCtx.arc((canvas.width/2)+(link.objects[0].dimx/2),(canvas.height/2)+(link.objects[0].dimy/2),150,0,2*Math.PI,false);
                maskCtx.fill();
                maskCtx.closePath();
              //  maskCtx.fill();
            }
            
            maskCtx.beginPath();
                maskCtx.arc(canvas.width-250+75,canvas.height-250+75,68,0,2*Math.PI,false);
                maskCtx.fill();
                maskCtx.closePath();
            
            
            maskCtx.beginPath();
                maskCtx.arc(canvas.width-400+75,canvas.height-400+75,68,0,2*Math.PI,false);
                maskCtx.fill();
                maskCtx.closePath();
            
            if(torch!=null){

                for(let i=0;i<torch.objects.length;i++){
                     maskCtx.beginPath();
                    if(torch.objects[i].animation==1)maskCtx.arc((torch.objects[i].x+game.getcamerax())+(torch.objects[i].dimx/2),(torch.objects[i].y+game.getcameray())+(torch.objects[i].dimy/2),200,0,2*Math.PI,false);
                    maskCtx.fill();
                    maskCtx.closePath();
                  //  maskCtx.fill();
                }

            }
          //  maskCtx.fill();
            ctx.drawImage(maskCanvas, 0, 0);
            
            if((game.collideswiths(link.objects[0],"chest")||game.isclose(link.objects[0], chest.objects[0]))&&buttonB.objects[0].mousepressed==true){
                if(chest.objects[0].animation==0){chest.objects[0].animation=1;game.addobject(sword,chest.objects[0].x+25,chest.objects[0].y+45,50,70,0,false);}
           
            }
            
            
            
        }
        else if(game.currentmap==5){
            
            if(game.collideswiths(link.objects[0],"trigger")){
                
                if(game.collideswithanoterobject(link.objects[0],trigger.objects[0])){
                    
                     game.currentmap=2;
                    link.objects[0].y=link.objects[0].y-130;
                    
                }
                if(game.collideswithanoterobject(link.objects[0],trigger.objects[1])){
                    
                     game.currentmap=6;
                    link.objects[0].y=link.objects[0].y+130;
                    
                }
                
               
            }
            if(guard.objects[0].ghost==true &&guard.objects[0].counter4==0){game.addobject(health,guard.objects[0].x+25,guard.objects[0].y+25,30,30,0,false);guard.objects[0].counter4=1;}
            
            if(guard.objects[0].ghost==true){
                
                gate.objects[0].health--;
                
                if(gate.objects[0].health<0)gate.objects[0].health=-10;
                else if(gate.objects[0].health<99)gate.objects[0].x--;
                
                
                
            }
        }
        else if(game.currentmap==6){
            
            
            
            if(game.collideswiths(link.objects[0],"trigger")){
                
                if(game.collideswithanoterobject(link.objects[0],trigger.objects[0])){
                    
                     game.currentmap=5;
                    link.objects[0].y=link.objects[0].y-130;
                    
                }
            }
            
            if(guard.objects[0].ghost==true &&guard.objects[0].counter4==0){game.addobject(health,guard.objects[0].x+25,guard.objects[0].y+25,30,30,0,false);guard.objects[0].counter4=1;}
            if(guard.objects[1].ghost==true &&guard.objects[1].counter4==0){game.addobject(health,guard.objects[1].x+25,guard.objects[1].y+25,30,30,0,false);guard.objects[1].counter4=1;}
            
            
            if(guard.objects[0].ghost==true&&guard.objects[1].ghost==true){
                
                if(chest.objects[0].animation==2&&!game.collideswiths(chest.objects[0],"any")){chest.objects[0].animation=0;chest.objects[0].ghost=false;}
                if((game.collideswiths(link.objects[0],"chest")||game.isclose(link.objects[0], chest.objects[0]))&&buttonB.objects[0].mousepressed==true&&chest.objects[0].animation==0){chest.objects[0].animation=1;game.addobject(shield,chest.objects[0].x+25,chest.objects[0].y+85,40,30,0,false);}
                
                
            }
            else{
                chest.objects[0].animation=2;chest.objects[0].ghost=true;
                
            }
            
            
            
            
        }
        
        
    }
    
    
    
    
    
    
    
    
    
    
}